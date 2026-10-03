// An audio effect's Modulation as the chain runs it (see chain.ts): how far
// each modulated knob swings at the end of a block. Transient listens for
// hits on the stage's own input with the detector Animation's Reactive mode
// uses, and moves the knobs exactly as Reactive does; LFO follows a
// waveform on session time. A swing is a fraction of the knob's travel, so
// a log-taper knob such as a cutoff frequency swings by ratio.
//
// Runs inside the chain worklet as well as offline, so it imports nothing
// with side effects.
import type { ReactiveMotion } from "../fx-animation-defaults.ts";
import {
  DEFAULT_REACTIVE_RANGE_SCALE,
  placeOnsets,
  REACTIVE_FRAME_RATE,
  reactiveOffset,
  reactiveSwingAt,
} from "../fx-animation-impulse.ts";
import type { LfoShape } from "../fx-modulation-defaults.ts";
import {
  AudioBandTracker,
  BAND_TICK_RATE,
  ByteSpectrum,
  SPECTRUM_SIZE,
} from "../fx-shaders/audio-bands.ts";
import { taperPosition, taperValue } from "../fx/taper.ts";
import type { FxNumberTaper } from "../fx/types.ts";
import type { AudioBlockTime, AudioTempo } from "./processor.ts";
import { noteValueSeconds } from "./tempo.ts";

// A knob the modifier moves, with the range it is clamped to.
export type ModulatedParameter = {
  key: string;
  min: number;
  max: number;
  taper?: FxNumberTaper;
};

export type AudioStageTransient = {
  mode: "transient";
  motion: ReactiveMotion;
  reactivity: number;
  // How long a swing takes, in frames at REACTIVE_FRAME_RATE.
  lengthFrames: number;
  parameters: readonly ModulatedParameter[];
};

export type AudioStageLfo = {
  mode: "lfo";
  shape: LfoShape;
  sync: boolean;
  rate: number;
  note: string;
  depth: number;
  // Degrees, 0..360.
  phase: number;
  parameters: readonly ModulatedParameter[];
};

// A stage's Modulation, as resolved from the session: plain data, so it can
// be posted to the chain worklet.
export type AudioStageModulation = AudioStageTransient | AudioStageLfo;

// The waveform at `phase` (0 up to 1 through a cycle), -1..1. Sine,
// Triangle and Saw Up rise from the middle at phase 0; Saw Down falls from
// it. `random` is the value Random holds for the cycle.
export function lfoWaveform(shape: LfoShape, phase: number, random = 0) {
  switch (shape) {
    case "Sine":
      return Math.sin(2 * Math.PI * phase);
    case "Triangle":
      return phase < 0.25
        ? 4 * phase
        : phase < 0.75
          ? 2 - 4 * phase
          : 4 * phase - 4;
    case "Saw Up":
      return phase < 0.5 ? 2 * phase : 2 * phase - 2;
    case "Saw Down":
      return phase < 0.5 ? -2 * phase : 2 - 2 * phase;
    case "Square":
      return phase < 0.5 ? 1 : -1;
    case "Random":
      return random;
  }
}

// Seconds per LFO cycle: the synced note value at the session tempo, or the
// free rate. Undefined when neither gives a cycle.
export function lfoPeriodSeconds(
  lfo: Pick<AudioStageLfo, "sync" | "rate" | "note">,
  tempo: AudioTempo,
) {
  if (lfo.sync) {
    return noteValueSeconds(lfo.note, tempo);
  }
  return lfo.rate > 0 ? 1 / lfo.rate : undefined;
}

// The LFO's value, -1..1, at timeline second `timeSeconds`. It counts
// cycles from the timeline's start, so a synced LFO lines up with bars and
// lands on the same value however playback got there. Random holds a value
// per cycle drawn from `seed`, the effect's id, so preview and export agree.
export function lfoValue(
  lfo: Pick<AudioStageLfo, "shape" | "sync" | "rate" | "note" | "phase">,
  seed: string,
  timeSeconds: number,
  tempo: AudioTempo,
) {
  const period = lfoPeriodSeconds(lfo, tempo);
  if (!period) {
    return 0;
  }
  const cycles = timeSeconds / period + lfo.phase / 360;
  const cycle = Math.floor(cycles);
  return lfoWaveform(
    lfo.shape,
    cycles - cycle,
    lfo.shape === "Random" ? reactiveOffset(seed, "", cycle) : 0,
  );
}

// `base` moved by `swing`, a fraction of the knob's travel, and clamped to
// its range. No swing leaves it as it is, even outside its range.
export function modulatedValue(
  base: number,
  swing: number,
  parameter: ModulatedParameter,
) {
  if (swing === 0) {
    return base;
  }
  const { min, max, taper } = parameter;
  return taperValue(
    taperPosition(base, min, max, taper) + swing,
    min,
    max,
    taper,
  );
}

// Listens for hits on a stage's input: down-mixed to mono, measured on the
// band tracker's 60 Hz timeline grid as the preview's analyser measures the
// mix for Reactive.
class HitListener {
  private readonly ring = new Float32Array(SPECTRUM_SIZE);
  private at = 0;
  private readonly spectrum = new ByteSpectrum();
  private readonly tracker = new AudioBandTracker();
  // The grid tick last stepped, or -1 before the first.
  private tick = -1;
  private readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  reset() {
    this.ring.fill(0);
    this.at = 0;
    this.tracker.reset();
    this.tick = -1;
  }

  // Feeds a block ending at timeline second `endSeconds` and returns the
  // hits heard so far, in timeline seconds.
  listen(input: readonly Float32Array[], frames: number, endSeconds: number) {
    const { ring } = this;
    const channels = input.length;
    for (let index = 0; index < frames; index++) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel++) {
        sum += input[channel][index];
      }
      ring[this.at] = channels ? sum / channels : 0;
      this.at = this.at + 1 === ring.length ? 0 : this.at + 1;
    }

    const target = Math.floor(endSeconds * BAND_TICK_RATE + 1e-6);
    // A jump back, or past the hits it remembers, starts listening afresh.
    if (
      this.tick < 0 ||
      target < this.tick ||
      target - this.tick > BAND_TICK_RATE
    ) {
      this.tracker.reset();
      this.tick = target - 1;
    }
    const read = (index: number) => ring[(this.at + index) % ring.length];
    while (this.tick < target) {
      this.tick += 1;
      this.tracker.step(this.spectrum.measure(read), this.sampleRate);
    }
    return placeOnsets(
      this.tracker.bands(0).onsets,
      this.tick / BAND_TICK_RATE,
    );
  }
}

// Works out a stage's swings block by block.
export class StageModulator {
  private listener: HitListener | null = null;
  private readonly swings = new Map<string, number>();
  private readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  reset() {
    this.listener?.reset();
  }

  // Each modulated knob's swing at the end of the block `input` holds, as a
  // fraction of its travel. `seed` is the effect's id.
  advance(
    modulation: AudioStageModulation,
    seed: string,
    input: readonly Float32Array[],
    frames: number,
    time: AudioBlockTime,
  ): ReadonlyMap<string, number> {
    const endSeconds = time.timeSeconds + frames / this.sampleRate;
    this.swings.clear();
    if (modulation.mode === "lfo") {
      this.listener = null;
      const swing =
        lfoValue(modulation, seed, endSeconds, time) *
        Math.min(1, modulation.depth) *
        DEFAULT_REACTIVE_RANGE_SCALE;
      for (const parameter of modulation.parameters) {
        this.swings.set(parameter.key, swing);
      }
      return this.swings;
    }

    this.listener ??= new HitListener(this.sampleRate);
    const onsets = this.listener.listen(input, frames, endSeconds);
    const hit = reactiveSwingAt(
      modulation,
      onsets,
      endSeconds,
      modulation.lengthFrames,
      REACTIVE_FRAME_RATE,
    );
    for (const parameter of modulation.parameters) {
      this.swings.set(
        parameter.key,
        hit
          ? reactiveOffset(seed, parameter.key, hit.seed) *
              hit.amount *
              DEFAULT_REACTIVE_RANGE_SCALE
          : 0,
      );
    }
    return this.swings;
  }
}
