// Runs an ordered chain of audio effects (a clip's stack, a track's bus or
// the Global master) block by block. The preview's chain worklet and the
// offline render both process through this class, so preview and export
// run identical DSP; only their hosts differ.
//
// Per block the chain:
//   1. ramps its input gain (a clip without Gain is gated silent);
//   2. runs each stage in order: number parameters ramp over
//      PARAMETER_RAMP_SECONDS, a switch change crossfades from a processor
//      at the old value to a fresh one at the new value, and bypassing or
//      enabling a stage crossfades between its dry input and its output,
//      all over SWITCH_CROSSFADE_SECONDS;
//   3. delays the result by its latency compensation.
// A stage with Modulation moves its modulated knobs from their stored values
// by the modulator's swing at the end of each block (see modulation.ts),
// ramped over PARAMETER_RAMP_SECONDS like an edit, so they never click.
// A stage whose input has been silent for longer than its tail and latency
// is idle: it is skipped and its processor dropped, so it starts afresh.
import {
  type ModulatedParameter,
  modulatedValue,
  StageModulator,
} from "./modulation.ts";
import {
  type AudioBlockTime,
  type AudioEffectDsp,
  type AudioEffectProcessor,
  type AudioParameterBlock,
  type AudioProcessorRegistry,
  type AudioStage,
  type AudioTempo,
  DEFAULT_TIME_SIGNATURE,
} from "./processor.ts";

// Frames per block: the Web Audio render quantum, which offline renders use
// too, so both hosts split the timeline into the same blocks.
export const BLOCK_FRAMES = 128;
export const PARAMETER_RAMP_SECONDS = 0.015;
export const SWITCH_CROSSFADE_SECONDS = 0.008;

// A value that moves linearly to its target over a number of frames.
export class Ramp {
  value: number;
  target: number;
  private step = 0;
  private remaining = 0;
  private readonly buffer: Float32Array;
  private filledWith = Number.NaN;

  constructor(value: number, maxFrames: number) {
    this.value = value;
    this.target = value;
    this.buffer = new Float32Array(maxFrames);
  }

  get changing() {
    return this.remaining > 0;
  }

  // Moves to `target` over `frames` frames, or at once when `frames` is 0.
  set(target: number, frames: number) {
    if (target === this.target) {
      return;
    }
    this.target = target;
    if (frames <= 0) {
      this.jump(target);
      return;
    }
    this.remaining = frames;
    this.step = (target - this.value) / frames;
  }

  jump(target: number) {
    this.value = target;
    this.target = target;
    this.remaining = 0;
  }

  // The values the last fill() gave.
  get values() {
    return this.buffer;
  }

  // The values over the next `frames` frames, advancing the ramp.
  fill(frames: number) {
    if (this.remaining === 0) {
      if (this.filledWith !== this.value) {
        this.buffer.fill(this.value);
        this.filledWith = this.value;
      }
      return this.buffer;
    }
    for (let index = 0; index < frames; index++) {
      if (this.remaining > 0) {
        this.remaining -= 1;
        this.value =
          this.remaining === 0 ? this.target : this.value + this.step;
      }
      this.buffer[index] = this.value;
    }
    this.filledWith = Number.NaN;
    return this.buffer;
  }
}

export function createBuffers(channels: number, frames: number) {
  return Array.from({ length: channels }, () => new Float32Array(frames));
}

export function isSilent(buffers: readonly Float32Array[], frames: number) {
  for (const buffer of buffers) {
    for (let index = 0; index < frames; index++) {
      if (buffer[index] !== 0) {
        return false;
      }
    }
  }
  return true;
}

function copy(
  from: readonly Float32Array[],
  to: Float32Array[],
  frames: number,
) {
  for (let channel = 0; channel < to.length; channel++) {
    to[channel].set(from[channel].subarray(0, frames));
  }
}

function clear(buffers: Float32Array[], frames: number) {
  for (const buffer of buffers) {
    buffer.fill(0, 0, frames);
  }
}

function enabledStages(stages: readonly AudioStage[]) {
  return stages.filter((stage) => stage.enabled);
}

// The frames an enabled chain of `stages` delays its input by.
export function chainLatencyFrames(
  registry: AudioProcessorRegistry,
  stages: readonly AudioStage[],
  sampleRate: number,
) {
  let frames = 0;
  for (const stage of enabledStages(stages)) {
    const latency =
      registry.get(stage.effectName)?.latencyFrames?.(stage, sampleRate) ?? 0;
    frames += Math.max(0, Math.round(latency));
  }
  return frames;
}

// How long `stages` keep sounding once their input falls silent.
export function chainTailSeconds(
  registry: AudioProcessorRegistry,
  stages: readonly AudioStage[],
  tempo: AudioTempo,
) {
  let seconds = 0;
  for (const stage of enabledStages(stages)) {
    const tail = registry.get(stage.effectName)?.tailSeconds?.(stage, tempo);
    seconds += tail !== undefined && tail > 0 ? tail : 0;
  }
  return seconds;
}

type StageHost = { sampleRate: number; channels: number; maxFrames: number };

// A knob's swing away from its stored value, ramped, and the values it
// gives over the block. A swing at rest leaves the knob at its stored value.
type Swing = {
  ramp: Ramp;
  parameter: ModulatedParameter;
  active: boolean;
  values: Float32Array;
  value: number;
};

type ProcessorSlot = {
  processor: AudioEffectProcessor;
  switches: Readonly<Record<string, string>>;
};

class ChainStage implements AudioParameterBlock {
  config: AudioStage;
  readonly dsp: AudioEffectDsp | undefined;
  private readonly ramps = new Map<string, Ramp>();
  private readonly swings = new Map<string, Swing>();
  private modulator: StageModulator | null = null;
  // Swings jump to their first values in the first block after a reset,
  // as the knobs do, and ramp from then on.
  private swingsSettled = false;
  private readonly changingKeys = new Set<string>();
  private readonly zeros: Float32Array;
  private readonly wet: Ramp;
  private current: ProcessorSlot | null = null;
  private fading: { slot: ProcessorSlot; weight: Ramp } | null = null;
  // The switches the processor being run reads.
  private switches: Readonly<Record<string, string>>;
  private readonly output: Float32Array[];
  private readonly faded: Float32Array[];
  // Frames since its input last made a sound.
  private silentFrames = Number.POSITIVE_INFINITY;
  drainFrames = 0;
  private readonly host: StageHost;

  constructor(
    config: AudioStage,
    dsp: AudioEffectDsp | undefined,
    host: StageHost,
  ) {
    this.host = host;
    this.config = config;
    this.dsp = dsp;
    this.switches = config.switches;
    this.zeros = new Float32Array(host.maxFrames);
    this.wet = new Ramp(config.enabled ? 1 : 0, host.maxFrames);
    this.output = createBuffers(host.channels, host.maxFrames);
    this.faded = createBuffers(host.channels, host.maxFrames);
    for (const [key, value] of Object.entries(config.numbers)) {
      this.ramps.set(key, new Ramp(value, host.maxFrames));
    }
  }

  update(config: AudioStage) {
    const rampFrames = Math.round(
      PARAMETER_RAMP_SECONDS * this.host.sampleRate,
    );
    const fadeFrames = Math.round(
      SWITCH_CROSSFADE_SECONDS * this.host.sampleRate,
    );
    for (const [key, value] of Object.entries(config.numbers)) {
      const ramp = this.ramps.get(key);
      if (ramp) {
        ramp.set(value, rampFrames);
      } else {
        this.ramps.set(key, new Ramp(value, this.host.maxFrames));
      }
    }
    if (!sameSwitches(this.config.switches, config.switches)) {
      if (this.current) {
        const weight = new Ramp(1, this.host.maxFrames);
        weight.set(0, fadeFrames);
        this.fading = { slot: this.current, weight };
        this.current = null;
      }
    }
    this.wet.set(config.enabled ? 1 : 0, fadeFrames);
    this.config = config;
  }

  reset() {
    this.current = null;
    this.fading = null;
    this.silentFrames = Number.POSITIVE_INFINITY;
    this.wet.jump(this.wet.target);
    for (const ramp of this.ramps.values()) {
      ramp.jump(ramp.target);
    }
    this.modulator?.reset();
    this.swingsSettled = false;
  }

  number(key: string) {
    const swing = this.swings.get(key);
    return swing?.active
      ? swing.values
      : (this.ramps.get(key)?.values ?? this.zeros);
  }

  value(key: string) {
    const swing = this.swings.get(key);
    return swing?.active ? swing.value : (this.ramps.get(key)?.value ?? 0);
  }

  changing(key: string) {
    return this.changingKeys.has(key);
  }

  switch(key: string) {
    return this.switches[key] ?? "";
  }

  // Processes `input` into this stage's output buffers and returns them.
  process(
    input: readonly Float32Array[],
    frames: number,
    time: AudioBlockTime,
  ): readonly Float32Array[] {
    if (!this.dsp) {
      return input;
    }
    const silent = isSilent(input, frames);
    this.silentFrames = silent ? this.silentFrames + frames : 0;
    this.modulate(input, frames, time);
    // Advances every ramp by the block; number() then reads the block.
    this.changingKeys.clear();
    for (const [key, ramp] of this.ramps) {
      if (ramp.changing) {
        this.changingKeys.add(key);
      }
      ramp.fill(frames);
    }
    this.applySwings(frames);
    const wetChanging = this.wet.changing;
    const wet = this.wet.fill(frames);

    if (silent && this.silentFrames - frames >= this.drainFrames) {
      this.current = null;
      this.fading = null;
      this.wet.jump(this.wet.target);
      clear(this.output, frames);
      return this.output;
    }
    if (!wetChanging && this.wet.value === 0) {
      this.current = null;
      this.fading = null;
      return input;
    }

    this.current ??= {
      processor: this.dsp.createProcessor(
        this.host.sampleRate,
        this.host.channels,
      ),
      switches: this.config.switches,
    };
    this.run(this.current, input, this.output, frames, time);
    if (this.fading) {
      const { slot, weight } = this.fading;
      this.run(slot, input, this.faded, frames, time);
      const old = weight.fill(frames);
      for (let channel = 0; channel < this.output.length; channel++) {
        const out = this.output[channel];
        const faded = this.faded[channel];
        for (let index = 0; index < frames; index++) {
          out[index] += (faded[index] - out[index]) * old[index];
        }
      }
      if (!weight.changing) {
        this.fading = null;
      }
    }

    if (wetChanging || this.wet.value !== 1) {
      for (let channel = 0; channel < this.output.length; channel++) {
        const out = this.output[channel];
        const dry = input[channel];
        for (let index = 0; index < frames; index++) {
          out[index] = dry[index] + (out[index] - dry[index]) * wet[index];
        }
      }
    }
    return this.output;
  }

  // Aims each modulated knob's swing at the modulator's value for the end
  // of the block. A knob no longer modulated swings back to its stored
  // value.
  private modulate(
    input: readonly Float32Array[],
    frames: number,
    time: AudioBlockTime,
  ) {
    const rampFrames = this.swingsSettled
      ? Math.round(PARAMETER_RAMP_SECONDS * this.host.sampleRate)
      : 0;
    this.swingsSettled = true;
    const modulation = this.config.modulation;
    if (!modulation) {
      this.modulator = null;
    } else {
      this.modulator ??= new StageModulator(this.host.sampleRate);
    }
    if (!modulation && !this.swings.size) {
      return;
    }
    const targets = modulation
      ? this.modulator?.advance(modulation, this.config.id, input, frames, time)
      : undefined;
    for (const parameter of modulation?.parameters ?? []) {
      const swing = this.swings.get(parameter.key);
      if (swing) {
        swing.parameter = parameter;
      } else if (this.ramps.has(parameter.key)) {
        this.swings.set(parameter.key, {
          ramp: new Ramp(0, this.host.maxFrames),
          parameter,
          active: false,
          values: new Float32Array(this.host.maxFrames),
          value: 0,
        });
      }
    }
    for (const [key, swing] of this.swings) {
      swing.ramp.set(targets?.get(key) ?? 0, rampFrames);
    }
  }

  // Fills each swung knob's values for the block from its stored value's
  // ramp and its swing's. Swings that have settled back to none rest, and
  // are dropped once their knob is no longer modulated.
  private applySwings(frames: number) {
    const modulated = this.config.modulation?.parameters;
    for (const [key, swing] of this.swings) {
      const { ramp, parameter, values } = swing;
      const base = this.ramps.get(key);
      swing.active = Boolean(base) && (ramp.changing || ramp.value !== 0);
      if (!base || !swing.active) {
        if (!modulated?.some((candidate) => candidate.key === key)) {
          this.swings.delete(key);
        }
        continue;
      }
      if (ramp.changing) {
        this.changingKeys.add(key);
      }
      const offsets = ramp.fill(frames);
      const stored = base.values;
      for (let index = 0; index < frames; index++) {
        values[index] = modulatedValue(
          stored[index],
          offsets[index],
          parameter,
        );
      }
      swing.value = values[frames - 1];
    }
  }

  private run(
    slot: ProcessorSlot,
    input: readonly Float32Array[],
    output: Float32Array[],
    frames: number,
    time: AudioBlockTime,
  ) {
    this.switches = slot.switches;
    slot.processor.process(input, output, frames, this, time);
  }
}

function sameSwitches(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

export type AudioChainSettings = {
  stages: readonly AudioStage[];
  // 1 to pass the input, 0 to gate it silent; ramped like a parameter.
  inputGain: number;
  // Frames of latency compensation after the stages.
  delayFrames: number;
};

export class AudioChain {
  private stages: ChainStage[] = [];
  private readonly inputGain: Ramp;
  private readonly gated: Float32Array[];
  private delay: { frames: number; lines: Float32Array[]; at: number } = {
    frames: 0,
    lines: [],
    at: 0,
  };
  private configured = false;
  // Frames since its input last made a sound.
  private silentFrames = Number.POSITIVE_INFINITY;
  private tempo: AudioTempo = { bpm: 120, signature: DEFAULT_TIME_SIGNATURE };
  private drain = 0;
  private readonly registry: AudioProcessorRegistry;
  readonly sampleRate: number;
  readonly channels: number;
  readonly maxFrames: number;

  constructor(
    registry: AudioProcessorRegistry,
    sampleRate: number,
    channels: number,
    maxFrames = BLOCK_FRAMES,
  ) {
    this.registry = registry;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.maxFrames = maxFrames;
    this.inputGain = new Ramp(1, maxFrames);
    this.gated = createBuffers(channels, maxFrames);
  }

  // Applies new settings. The first call sets every value at once; later
  // ones ramp and crossfade to them.
  configure(settings: AudioChainSettings, tempo: AudioTempo) {
    const host = {
      sampleRate: this.sampleRate,
      channels: this.channels,
      maxFrames: this.maxFrames,
    };
    const byId = new Map(this.stages.map((stage) => [stage.config.id, stage]));
    this.stages = settings.stages.map((config) => {
      const existing = byId.get(config.id);
      if (existing && existing.config.effectName === config.effectName) {
        existing.update(config);
        return existing;
      }
      return new ChainStage(config, this.registry.get(config.effectName), host);
    });
    for (const stage of this.stages) {
      // A bypassed stage still drains while it fades out.
      const tail = stage.dsp?.tailSeconds?.(stage.config, tempo) ?? 0;
      const latency =
        stage.dsp?.latencyFrames?.(stage.config, this.sampleRate) ?? 0;
      stage.drainFrames =
        Math.ceil(Math.max(0, tail) * this.sampleRate) +
        Math.max(0, Math.round(latency));
    }
    this.tempo = tempo;
    if (this.configured) {
      this.inputGain.set(
        settings.inputGain,
        Math.round(SWITCH_CROSSFADE_SECONDS * this.sampleRate),
      );
    } else {
      this.inputGain.jump(settings.inputGain);
    }
    this.configured = true;
    const delayFrames = Math.max(0, Math.round(settings.delayFrames));
    if (delayFrames !== this.delay.frames) {
      this.delay = {
        frames: delayFrames,
        lines: createBuffers(this.channels, delayFrames),
        at: 0,
      };
    }
    this.drain =
      this.stages.reduce((total, stage) => total + stage.drainFrames, 0) +
      delayFrames;
  }

  // The frames the chain keeps sounding for after its input falls silent:
  // its stages' tails and latency, and its compensation delay.
  get tailFrames() {
    return this.drain;
  }

  // Drops every processor's state and the delay line, as after a seek.
  reset() {
    for (const stage of this.stages) {
      stage.reset();
    }
    this.inputGain.jump(this.inputGain.target);
    for (const line of this.delay.lines) {
      line.fill(0);
    }
    this.delay.at = 0;
    this.silentFrames = Number.POSITIVE_INFINITY;
  }

  // Processes `frames` frames of `input` into `output`; `time` gives the
  // timeline second of the block's first frame.
  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    frames: number,
    timeSeconds: number,
  ) {
    const silentInput = isSilent(input, frames);
    this.silentFrames = silentInput ? this.silentFrames + frames : 0;
    if (silentInput && this.silentFrames - frames >= this.drain) {
      // Idle: nothing left ringing, so nothing to run.
      this.inputGain.fill(frames);
      clear(output, frames);
      return;
    }

    const gainChanging = this.inputGain.changing;
    const gain = this.inputGain.fill(frames);
    for (let channel = 0; channel < this.channels; channel++) {
      const from = input[channel];
      const to = this.gated[channel];
      if (!gainChanging && this.inputGain.value === 1) {
        to.set(from.subarray(0, frames));
      } else {
        for (let index = 0; index < frames; index++) {
          to[index] = from[index] * gain[index];
        }
      }
    }

    const time: AudioBlockTime = {
      ...this.tempo,
      sampleRate: this.sampleRate,
      timeSeconds,
    };
    let signal: readonly Float32Array[] = this.gated;
    for (const stage of this.stages) {
      signal = stage.process(signal, frames, time);
    }

    if (!this.delay.frames) {
      copy(signal, output, frames);
      return;
    }
    const { lines, frames: length } = this.delay;
    let at = this.delay.at;
    for (let index = 0; index < frames; index++) {
      for (let channel = 0; channel < this.channels; channel++) {
        const line = lines[channel];
        output[channel][index] = line[at];
        line[at] = signal[channel][index];
      }
      at = at + 1 === length ? 0 : at + 1;
    }
    this.delay.at = at;
  }
}
