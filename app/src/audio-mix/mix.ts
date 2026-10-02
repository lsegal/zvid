// The audio mix itself: each contributing clip's media, at its amplitude,
// summed, then the master gain and a soft limiter. Export renders it here
// from decoded samples; the preview builds the same graph in Web Audio (see
// preview-mixer.ts) with the same limiter curve, so the two agree.
import { warpSourceTime } from "../clip-warp.ts";
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
// its source window, or before the media's start.
export function clipMediaTimeAt(
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

// Warped clips look their source time up once per this many samples and
// interpolate in between; warp maps are linear between markers, so this
// only blurs the corner at a marker by a sample or two.
const WARP_STEP_SAMPLES = 64;

function sampleAt(data: Float32Array, position: number) {
  const index = Math.floor(position);
  if (index < 0 || index >= data.length) {
    return 0;
  }
  const next = index + 1 < data.length ? data[index + 1] : 0;
  return data[index] + (next - data[index]) * (position - index);
}

// Adds `clip`'s media into `output` at `amplitude`.
function addClip(
  output: Float32Array[],
  clip: AudioMixClip,
  media: DecodedAudio,
  amplitude: number,
  bpm: number,
  { sampleRate, startSeconds, length }: AudioMixRenderOptions,
) {
  const first = Math.max(
    0,
    Math.floor((clip.startSeconds - startSeconds) * sampleRate),
  );
  const end = Math.min(
    length,
    Math.ceil(
      (clip.startSeconds + clip.durationSeconds - startSeconds) * sampleRate,
    ),
  );
  if (end <= first || !media.channels.length) {
    return;
  }

  const sourceTime = (index: number) =>
    clipMediaTimeAt(clip, startSeconds + index / sampleRate, bpm)?.mediaTime;
  // Warped clips: source time at the start of the current step and the
  // next, interpolated in between.
  let stepStart = -1;
  let stepLength = 0;
  let stepFrom: number | undefined;
  let stepTo: number | undefined;
  for (let index = first; index < end; index++) {
    let mediaTime: number | undefined;
    if (clip.warp) {
      if (stepStart < 0 || index - stepStart >= WARP_STEP_SAMPLES) {
        stepStart = index;
        stepLength = Math.min(end - 1, index + WARP_STEP_SAMPLES) - index;
        stepFrom = sourceTime(index);
        stepTo = sourceTime(index + stepLength);
      }
      mediaTime =
        stepFrom === undefined || stepTo === undefined || stepLength === 0
          ? sourceTime(index)
          : stepFrom + ((stepTo - stepFrom) * (index - stepStart)) / stepLength;
    } else {
      mediaTime = sourceTime(index);
    }
    if (mediaTime === undefined) {
      continue;
    }
    const position = mediaTime * media.sampleRate;
    for (let channel = 0; channel < output.length; channel++) {
      const data = media.channels[channel % media.channels.length];
      output[channel][index] += amplitude * sampleAt(data, position);
    }
  }
}

// Renders `mix` from its clips' decoded media: every clip at its amplitude,
// summed, then the master gain and the limiter. Clips whose media is
// missing, or whose amplitude is 0, add nothing.
export function renderAudioMix(
  mix: AudioMix,
  mediaById: ReadonlyMap<string, DecodedAudio>,
  options: AudioMixRenderOptions,
) {
  const output = Array.from(
    { length: options.numberOfChannels },
    () => new Float32Array(options.length),
  );
  for (const clip of mix.clips) {
    const media = mediaById.get(clip.mediaId);
    if (media && clip.amplitude > 0) {
      addClip(output, clip, media, clip.amplitude, mix.bpm, options);
    }
  }
  for (const channel of output) {
    for (let index = 0; index < channel.length; index++) {
      channel[index] = softLimit(channel[index] * mix.masterAmplitude);
    }
  }
  return output;
}

// Whether any clip in `mix` can make a sound.
export function isAudibleMix(mix: AudioMix) {
  return mix.masterAmplitude > 0 && mix.clips.some((clip) => clip.amplitude > 0);
}

// The timeline second the last clip in `mix` ends at.
export function audioMixEndSeconds(mix: AudioMix) {
  return mix.clips.reduce(
    (end, clip) => Math.max(end, clip.startSeconds + clip.durationSeconds),
    0,
  );
}
