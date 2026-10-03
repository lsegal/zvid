// The audio mix itself: each contributing clip's media through its own
// chain, summed into its track's bus chain, summed into the master chain,
// then a soft limiter (see resolve.ts). Export and the offline audio bands
// render it here from decoded samples, block by block; the preview builds
// the same graph in Web Audio (see preview-mixer.ts), running the same
// chains in a worklet and the same limiter curve, so the two agree.
import { loopMediaTime, warpSourceTime } from "../clip-warp.ts";
import {
  AudioChain,
  BLOCK_FRAMES,
  chainLatencyFrames,
  chainTailSeconds,
  createBuffers,
} from "./chain.ts";
import type {
  AudioProcessorRegistry,
  AudioStage,
  AudioTempo,
} from "./processor.ts";
import { AUDIO_PROCESSORS } from "./processors.ts";
import type { AudioMix, AudioMixClip } from "./resolve.ts";

// Below the knee the limiter passes the mix through untouched. Above it, the
// mix bends smoothly towards full scale (0 dBFS) and never exceeds it.
export const LIMITER_KNEE = 0.9;

// The Web Audio limiter scales its input by 1 / headroom so a WaveShaper,
// whose curve spans −1..1, sees mixes up to this many times full scale.
export const LIMITER_HEADROOM = 8;
export const LIMITER_CURVE_POINTS = 8193;

export function softLimit(sample: number) {
  const magnitude = Math.abs(sample);
  if (magnitude <= LIMITER_KNEE) {
    return sample;
  }
  const room = 1 - LIMITER_KNEE;
  return (
    Math.sign(sample) *
    (LIMITER_KNEE + room * Math.tanh((magnitude - LIMITER_KNEE) / room))
  );
}

// The WaveShaper curve for an input scaled by 1 / LIMITER_HEADROOM.
export function limiterCurve(points = LIMITER_CURVE_POINTS) {
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index++) {
    const input = (index / (points - 1)) * 2 - 1;
    curve[index] = softLimit(input * LIMITER_HEADROOM);
  }
  return curve;
}

export type ClipMediaTime = {
  // Where the clip's media plays, in source seconds.
  mediaTime: number;
  // Source seconds per timeline second: 1 unless warped.
  playbackRate: number;
};

// Where `clip`'s media plays at timeline second `seconds`, the way its video
// would, or undefined when the clip is silent there: outside the clip or
// its source window, or before the media's start. Past the media's end it
// loops the media.
export function clipMediaTimeAt(
  clip: AudioMixClip,
  seconds: number,
  bpm: number,
): ClipMediaTime | undefined {
  const media = clipUnloopedMediaTimeAt(clip, seconds, bpm);
  return (
    media && {
      ...media,
      mediaTime: loopMediaTime(media.mediaTime, clip.mediaDurationSeconds ?? 0),
    }
  );
}

// clipMediaTimeAt before the media loops: past the media's end it keeps
// counting on.
function clipUnloopedMediaTimeAt(
  clip: AudioMixClip,
  seconds: number,
  bpm: number,
): ClipMediaTime | undefined {
  const epsilon = 1e-6;
  if (
    seconds < clip.startSeconds - epsilon ||
    seconds >= clip.startSeconds + clip.durationSeconds - epsilon
  ) {
    return undefined;
  }
  const linear = seconds + clip.sourceOffsetSeconds;
  if (
    linear < clip.sourceWindowStartSeconds - epsilon ||
    linear >= clip.sourceWindowEndSeconds - epsilon
  ) {
    return undefined;
  }
  const { seconds: mediaTime, rate: playbackRate } = clip.warp
    ? warpSourceTime(clip.warp, linear, bpm)
    : { seconds: linear, rate: 1 };
  return mediaTime >= 0 ? { mediaTime, playbackRate } : undefined;
}

export type DecodedAudio = {
  sampleRate: number;
  channels: Float32Array[];
};

export type AudioMixRenderOptions = {
  sampleRate: number;
  numberOfChannels: number;
  // The timeline second the first sample is at.
  startSeconds: number;
  // Samples per channel.
  length: number;
};

// The timeline second whose media `clip` plays at each timeline second,
// through its enabled source stages (see AudioSourceStage), or undefined
// when it has none and plays its own.
export function clipReadSeconds(
  clip: Pick<AudioMixClip, "startSeconds" | "durationSeconds" | "stages">,
  registry: AudioProcessorRegistry = AUDIO_PROCESSORS,
): ((seconds: number) => number) | undefined {
  const stages = clip.stages.flatMap((stage) => {
    const source = registry.get(stage.effectName)?.source;
    return stage.enabled && source ? [{ stage, source }] : [];
  });
  if (!stages.length) {
    return undefined;
  }
  const span = {
    startSeconds: clip.startSeconds,
    endSeconds: clip.startSeconds + clip.durationSeconds,
  };
  return (seconds) =>
    stages.reduce(
      (read, { stage, source }) => source.readSeconds(read, span, stage),
      seconds,
    );
}

// Clips look their source time up once per this many samples and
// interpolate in between. Source time is linear in timeline time, or for a
// warped clip linear between its markers, so this only blurs the corner at
// a warp marker by a sample or two. Both are taken before the media loops,
// so a step in which it loops back to its start does not sweep back through
// it.
const STEP_SAMPLES = 64;

function sampleAt(data: Float32Array, position: number) {
  const index = Math.floor(position);
  if (index < 0 || index >= data.length) {
    return 0;
  }
  const next = index + 1 < data.length ? data[index + 1] : 0;
  return data[index] + (next - data[index]) * (position - index);
}

// Reads a clip's media into the blocks of a render whose frame 0 is at
// timeline second `originSeconds`, the way its video would play, through
// its source stages.
export class ClipReader {
  // The frames it plays over, the end excluded.
  readonly firstFrame: number;
  readonly endFrame: number;
  // The source time at the start of each step and the next, interpolated in
  // between. Steps that cross the clip's silent edges look up every sample.
  private stepStart = -1;
  private stepLength = 0;
  private stepFrom: number | undefined;
  private stepTo: number | undefined;
  private readonly readSeconds: ((seconds: number) => number) | undefined;
  private readonly clip: AudioMixClip;
  private readonly media: DecodedAudio;
  private readonly bpm: number;
  private readonly sampleRate: number;
  private readonly originSeconds: number;

  constructor(
    clip: AudioMixClip,
    media: DecodedAudio,
    bpm: number,
    sampleRate: number,
    originSeconds: number,
    registry: AudioProcessorRegistry = AUDIO_PROCESSORS,
  ) {
    this.clip = clip;
    this.media = media;
    this.bpm = bpm;
    this.sampleRate = sampleRate;
    this.originSeconds = originSeconds;
    this.firstFrame = Math.max(
      0,
      Math.floor((clip.startSeconds - originSeconds) * sampleRate),
    );
    this.endFrame = Math.ceil(
      (clip.startSeconds + clip.durationSeconds - originSeconds) * sampleRate,
    );
    this.readSeconds = clipReadSeconds(clip, registry);
  }

  private sourceTime(frame: number) {
    const seconds = this.originSeconds + frame / this.sampleRate;
    return clipUnloopedMediaTimeAt(
      this.clip,
      this.readSeconds ? this.readSeconds(seconds) : seconds,
      this.bpm,
    )?.mediaTime;
  }

  // Writes frames `block` to `block + frames` into `target`, silent outside
  // the clip.
  read(target: Float32Array[], block: number, frames: number) {
    for (const channel of target) {
      channel.fill(0, 0, frames);
    }
    const media = this.media;
    if (!media.channels.length) {
      return;
    }
    const from = Math.max(block, this.firstFrame);
    const to = Math.min(block + frames, this.endFrame);
    for (let index = from; index < to; index++) {
      if (this.stepStart < 0 || index - this.stepStart >= STEP_SAMPLES) {
        this.stepStart = index;
        this.stepLength =
          Math.min(this.endFrame - 1, index + STEP_SAMPLES) - index;
        this.stepFrom = this.sourceTime(index);
        this.stepTo = this.sourceTime(index + this.stepLength);
      }
      const stepFrom = this.stepFrom;
      const stepTo = this.stepTo;
      const stepLength = this.stepLength;
      const stepStart = this.stepStart;
      const mediaTime =
        stepFrom === undefined || stepTo === undefined || stepLength === 0
          ? this.sourceTime(index)
          : stepFrom + ((stepTo - stepFrom) * (index - stepStart)) / stepLength;
      if (mediaTime === undefined) {
        continue;
      }
      const position =
        loopMediaTime(mediaTime, this.clip.mediaDurationSeconds ?? 0) *
        media.sampleRate;
      for (let channel = 0; channel < target.length; channel++) {
        const data = media.channels[channel % media.channels.length];
        target[channel][index - block] = sampleAt(data, position);
      }
    }
  }
}

export function audioMixTempo(mix: AudioMix): AudioTempo {
  return { bpm: mix.bpm, signature: mix.signature };
}

// How the mix's paths line up: each clip's chain is delayed so every clip
// reaches the master as late as the slowest path (a clip's chain and its
// bus's), and the whole mix comes out `latencyFrames` late, master
// included.
export type AudioMixTiming = {
  clipDelayFrames: ReadonlyMap<string, number>;
  latencyFrames: number;
  // The longest any clip keeps sounding past its end, through its chain,
  // its bus's and the master's.
  tailSeconds: number;
};

export function audioMixTiming(
  mix: AudioMix,
  sampleRate: number,
  registry: AudioProcessorRegistry = AUDIO_PROCESSORS,
): AudioMixTiming {
  const tempo = audioMixTempo(mix);
  const latency = (stages: readonly AudioStage[]) =>
    chainLatencyFrames(registry, stages, sampleRate);
  const tail = (stages: readonly AudioStage[]) =>
    chainTailSeconds(registry, stages, tempo);
  const busById = new Map(mix.buses.map((bus) => [bus.id, bus]));
  const paths = mix.clips.map((clip) => {
    const bus = busById.get(clip.busId)?.stages ?? [];
    return {
      clip,
      latency: latency(clip.stages) + latency(bus),
      tail: tail(clip.stages) + tail(bus),
    };
  });
  const slowest = Math.max(0, ...paths.map((path) => path.latency));
  return {
    clipDelayFrames: new Map(
      paths.map((path) => [path.clip.id, slowest - path.latency]),
    ),
    latencyFrames: slowest + latency(mix.master),
    tailSeconds:
      Math.max(0, ...paths.map((path) => path.tail)) + tail(mix.master),
  };
}

function addInto(
  target: Float32Array[],
  source: readonly Float32Array[],
  frames: number,
) {
  for (let channel = 0; channel < target.length; channel++) {
    const to = target[channel];
    const from = source[channel];
    for (let index = 0; index < frames; index++) {
      to[index] += from[index];
    }
  }
}

function clearBuffers(buffers: Float32Array[]) {
  for (const buffer of buffers) {
    buffer.fill(0);
  }
}

// Renders `mix` from its clips' decoded media: every clip through its
// chain, summed into its bus's chain, summed into the master chain, then
// the limiter. Clips whose media is missing, or whose amplitude is 0, add
// nothing. It starts early enough for tails from before `startSeconds` to
// ring into the range, and compensates the mix's latency, so the range
// sounds as it does when played through.
export function renderAudioMix(
  mix: AudioMix,
  mediaById: ReadonlyMap<string, DecodedAudio>,
  options: AudioMixRenderOptions,
  registry: AudioProcessorRegistry = AUDIO_PROCESSORS,
) {
  const { sampleRate, numberOfChannels: channels, length } = options;
  const output = createBuffers(channels, length);
  const timing = audioMixTiming(mix, sampleRate, registry);
  const tempo = audioMixTempo(mix);
  const preRoll = Math.max(
    0,
    Math.min(
      Math.floor(options.startSeconds * sampleRate),
      Math.ceil(timing.tailSeconds * sampleRate) + timing.latencyFrames,
    ),
  );
  const originSeconds = options.startSeconds - preRoll / sampleRate;
  const skip = preRoll + timing.latencyFrames;
  const total = skip + length;
  const chainOf = (stages: AudioStage[], inputGain = 1, delayFrames = 0) => {
    const chain = new AudioChain(registry, sampleRate, channels);
    chain.configure({ stages, inputGain, delayFrames }, tempo);
    return chain;
  };

  const buses = new Map(
    mix.buses.map((bus) => [
      bus.id,
      {
        chain: chainOf(bus.stages),
        input: createBuffers(channels, BLOCK_FRAMES),
      },
    ]),
  );
  const voices = mix.clips.flatMap((clip) => {
    const media = mediaById.get(clip.mediaId);
    const bus = buses.get(clip.busId);
    if (!media || !bus || !(clip.amplitude > 0)) {
      return [];
    }
    const chain = chainOf(
      clip.stages,
      clip.hasGain ? 1 : 0,
      timing.clipDelayFrames.get(clip.id),
    );
    const reader = new ClipReader(
      clip,
      media,
      mix.bpm,
      sampleRate,
      originSeconds,
      registry,
    );
    return [{ chain, reader, bus }];
  });
  const master = chainOf(mix.master);
  const voiceInput = createBuffers(channels, BLOCK_FRAMES);
  const chainOutput = createBuffers(channels, BLOCK_FRAMES);
  const masterInput = createBuffers(channels, BLOCK_FRAMES);
  const masterOutput = createBuffers(channels, BLOCK_FRAMES);

  for (let block = 0; block < total; block += BLOCK_FRAMES) {
    const frames = Math.min(BLOCK_FRAMES, total - block);
    const timeSeconds = originSeconds + block / sampleRate;
    for (const bus of buses.values()) {
      clearBuffers(bus.input);
    }
    for (const { chain, reader, bus } of voices) {
      if (
        block + frames <= reader.firstFrame ||
        block >= reader.endFrame + chain.tailFrames
      ) {
        continue;
      }
      reader.read(voiceInput, block, frames);
      chain.process(voiceInput, chainOutput, frames, timeSeconds);
      addInto(bus.input, chainOutput, frames);
    }
    clearBuffers(masterInput);
    for (const bus of buses.values()) {
      bus.chain.process(bus.input, chainOutput, frames, timeSeconds);
      addInto(masterInput, chainOutput, frames);
    }
    master.process(masterInput, masterOutput, frames, timeSeconds);
    for (let channel = 0; channel < channels; channel++) {
      const from = masterOutput[channel];
      const to = output[channel];
      for (let index = Math.max(0, skip - block); index < frames; index++) {
        to[block + index - skip] = softLimit(from[index]);
      }
    }
  }
  return output;
}

// Whether any clip in `mix` can make a sound.
export function isAudibleMix(mix: AudioMix) {
  return (
    mix.masterAmplitude > 0 && mix.clips.some((clip) => clip.amplitude > 0)
  );
}

// The timeline second the last clip in `mix` ends at.
export function audioMixEndSeconds(mix: AudioMix) {
  return mix.clips.reduce(
    (end, clip) => Math.max(end, clip.startSeconds + clip.durationSeconds),
    0,
  );
}
