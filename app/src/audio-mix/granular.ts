// Plays a MIDI clip's notes through its Granular effect. Each note is a
// cloud of grains: short, Hann-windowed reads of a built-in source sound,
// played back faster or slower for the note's pitch and started `density`
// times a second from the note's start through its release. The source and
// the grains' random strays are seeded, so a clip renders the same samples
// every time, in the preview and in export alike. The grains are mixed here
// and the mix goes through the lowpass filter the Synth's voices do (see
// synth.ts).
import type { GranularParams, MidiNote } from "../midi-clip.ts";
import type { DecodedAudio } from "./mix.ts";

// A cloud's peak level at full velocity, leaving headroom for chords.
export const GRANULAR_VOICE_LEVEL = 0.25;
// The pitch the source sounds at when read at its own rate: middle C.
export const GRANULAR_SOURCE_PITCH = 60;
// The shortest attack and release, so a cloud never clicks on or off.
const MIN_RAMP_SECONDS = 0.002;
// How many periods of its fundamental the source lasts, about 2 s, so it
// loops seamlessly for grains that read past its end.
const SOURCE_PERIODS = 523;
const SOURCE_PARTIALS = 12;

/** A grain, in seconds from the clip's content start. */
export type Grain = {
  startSeconds: number;
  durationSeconds: number;
  // Where in the source it starts reading, from 0 to 1.
  offset: number;
  // How fast it reads the source: 2 is an octave up.
  rate: number;
  level: number;
};

/** A seeded random generator (mulberry32) returning numbers in [0, 1). */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const sources = new Map<number, Float32Array>();

/**
 * The source sound grains read, at `sampleRate`: a tone at middle C whose
 * harmonics brighten, and whose partials beat more, from its start
 * (Position 0) to its end (Position 1). It is the same every time for a
 * sample rate.
 */
export function granularSource(sampleRate: number): Float32Array {
  const cached = sources.get(sampleRate);
  if (cached) {
    return cached;
  }
  const fundamental = 440 * 2 ** ((GRANULAR_SOURCE_PITCH - 69) / 12);
  const length = Math.round((SOURCE_PERIODS / fundamental) * sampleRate);
  const random = seededRandom(0x6a7d);
  const phases = Array.from(
    { length: SOURCE_PARTIALS },
    () => random() * 2 * Math.PI,
  );
  // Each partial swells a whole number of times over the source, so it
  // loops without a seam.
  const swells = Array.from(
    { length: SOURCE_PARTIALS },
    () => 1 + Math.floor(random() * 6),
  );
  const data = new Float32Array(length);
  let peak = 0;
  for (let index = 0; index < length; index++) {
    const along = index / length;
    const cycles = (SOURCE_PERIODS * index) / length;
    let sample = 0;
    for (let partial = 1; partial <= SOURCE_PARTIALS; partial++) {
      const swell =
        1 -
        0.6 *
          along *
          (0.5 + 0.5 * Math.cos(2 * Math.PI * swells[partial - 1] * along));
      sample +=
        partial ** -(2.2 - 1.4 * along) *
        swell *
        Math.sin(2 * Math.PI * partial * cycles + phases[partial - 1]);
    }
    data[index] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  for (let index = 0; index < length; index++) {
    data[index] /= peak;
  }
  sources.set(sampleRate, data);
  return data;
}

// A note's seed, from what it plays, so the same note always strays alike.
function noteSeed(note: MidiNote, index: number) {
  return (
    Math.imul(note.pitch + 1, 0x9e3779b1) ^
    Math.imul(Math.round(note.start * 960) + 1, 0x85ebca6b) ^
    Math.imul(index + 1, 0xc2b2ae35)
  );
}

/**
 * The grains `notes` play through `params` at `bpm`, in seconds from the
 * clip's content start, leaving out grains that start at or after
 * `endSeconds`, where the clip's audio ends. Each note's cloud fades in over
 * the attack, holds until the note ends and fades out over the release.
 */
export function granularGrains(
  notes: readonly MidiNote[],
  params: GranularParams,
  bpm: number,
  endSeconds = Number.POSITIVE_INFINITY,
): Grain[] {
  const secondsPerQuarter = 60 / bpm;
  const attack = Math.max(MIN_RAMP_SECONDS, params.attack);
  const release = Math.max(MIN_RAMP_SECONDS, params.release);
  const interval = 1 / params.density;
  // Overlapping grains add up, so denser clouds play each one quieter.
  const overlap = Math.max(1, params.density * params.grainSize);
  return notes.flatMap((note, index) => {
    const start = note.start * secondsPerQuarter;
    if (start >= endSeconds || note.length <= 0) {
      return [];
    }
    const off = start + note.length * secondsPerQuarter;
    const cloudEnd = Math.min(endSeconds, off + release);
    const peak =
      (GRANULAR_VOICE_LEVEL * note.velocity) / 127 / Math.sqrt(overlap);
    const rate = 2 ** ((note.pitch + params.transpose - 60) / 12);
    const offLevel = Math.min(1, (off - start) / attack);
    const random = seededRandom(noteSeed(note, index));
    const grains: Grain[] = [];
    for (let at = start; at < cloudEnd; at += interval) {
      const jitter = (random() - 0.5) * params.spray * interval;
      const stray = (random() - 0.5) * params.spray;
      const startSeconds = Math.max(start, at + jitter);
      // A grain's level is the cloud's at its middle, where it peaks.
      const middle = startSeconds + params.grainSize / 2;
      const envelope =
        middle < off
          ? Math.min(1, (middle - start) / attack)
          : offLevel * (1 - (middle - off) / release);
      if (startSeconds >= cloudEnd || envelope <= 0) {
        continue;
      }
      grains.push({
        startSeconds,
        durationSeconds: params.grainSize,
        offset: (((params.position + stray) % 1) + 1) % 1,
        rate,
        level: peak * envelope,
      });
    }
    return grains;
  });
}

/**
 * `grains` mixed into `length` samples at `sampleRate`, each a
 * Hann-windowed read of `source`, looping past its end.
 */
export function mixGrains(
  grains: readonly Grain[],
  sampleRate: number,
  length: number,
  source = granularSource(sampleRate),
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  const sourceLength = source.length;
  for (const grain of grains) {
    const first = Math.round(grain.startSeconds * sampleRate);
    const count = Math.max(2, Math.round(grain.durationSeconds * sampleRate));
    const last = Math.min(length, first + count);
    for (let index = Math.max(0, first); index < last; index++) {
      const step = index - first;
      const read =
        (grain.offset * sourceLength + step * grain.rate) % sourceLength;
      const whole = Math.floor(read);
      const fraction = read - whole;
      const sample =
        source[whole] +
        (source[(whole + 1) % sourceLength] - source[whole]) * fraction;
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * step) / (count - 1));
      out[index] += grain.level * window * sample;
    }
  }
  return out;
}

/** `samples` at `sampleRate` through `params`' lowpass filter. */
export async function filterGranular(
  samples: Float32Array,
  params: Pick<GranularParams, "cutoff" | "resonance">,
  sampleRate: number,
): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, samples.length, sampleRate);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = params.resonance;
  source.connect(filter).connect(context.destination);
  source.start(0);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

/**
 * `notes` played through `params` at `bpm` and `sampleRate`, from the
 * clip's content start to `durationSeconds`, as decoded media.
 */
export async function renderGranularClip(
  notes: readonly MidiNote[],
  params: GranularParams,
  durationSeconds: number,
  bpm: number,
  sampleRate: number,
): Promise<DecodedAudio> {
  const length = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const grains = granularGrains(notes, params, bpm, durationSeconds);
  const mixed = mixGrains(grains, sampleRate, length);
  return {
    sampleRate,
    channels: [await filterGranular(mixed, params, sampleRate)],
  };
}
