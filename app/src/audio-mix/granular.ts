// Plays a MIDI clip's notes through its Granular effect. Each note is a
// cloud of grains: short, Hann-windowed reads of a built-in source sound,
// played back faster or slower for the note's pitch and started `density`
// times a second from the note's start through its release. The source and
// the grains' random strays are seeded, so a clip renders the same samples
// every time, in the preview and in export alike. The grains are mixed here,
// in a worker where one can start, and the mix goes through the lowpass filter the Synth's voices do (see
// synth.ts).
import type { GranularParams, MidiNote } from "../midi-clip.ts";
import type { GranularWorkerMessage } from "./granular.worker.ts";
import type { DecodedAudio } from "./mix.ts";

// A cloud's peak level at full velocity, leaving headroom for chords.
export const GRANULAR_VOICE_LEVEL = 0.25;
// The pitch the source sounds at when read at its own rate: middle C.
export const GRANULAR_SOURCE_PITCH = 60;
// The shortest attack and release, so a cloud never clicks on or off.
const MIN_RAMP_SECONDS = 0.002;
// How long the source lasts. A grain reading past either end reads back
// the other way, so it never jumps (see mirror).
const SOURCE_SECONDS = 2;
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
  const length = Math.round(SOURCE_SECONDS * sampleRate);
  const random = seededRandom(0x6a7d);
  const phases = Array.from(
    { length: SOURCE_PARTIALS },
    () => random() * 2 * Math.PI,
  );
  // How many times each partial swells over the source.
  const swells = Array.from(
    { length: SOURCE_PARTIALS },
    () => 1 + Math.floor(random() * 6),
  );
  const data = new Float32Array(length);
  let peak = 0;
  for (let index = 0; index < length; index++) {
    const along = index / length;
    const cycles = (fundamental * index) / sampleRate;
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

// `at` folded back into 0 to `length`, as a read bouncing off each end.
function mirror(at: number, length: number) {
  const folded = Math.abs(at) % (2 * length);
  return folded > length ? 2 * length - folded : folded;
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
    for (let step = 0; start + step * interval < cloudEnd; step++) {
      const at = start + step * interval;
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
        offset: mirror(params.position + stray, 1),
        rate,
        level: peak * envelope,
      });
    }
    return grains;
  });
}

// The Hann window over `count` samples, kept for the last count asked for,
// since every grain of a clip lasts as long.
let hann = new Float64Array(0);

function hannWindow(count: number) {
  if (hann.length !== count) {
    hann = new Float64Array(count);
    for (let step = 0; step < count; step++) {
      hann[step] = 0.5 - 0.5 * Math.cos((2 * Math.PI * step) / (count - 1));
    }
  }
  return hann;
}

/**
 * `grains` mixed into `length` samples at `sampleRate`, each a
 * Hann-windowed read of `source`, reading back the other way past its end.
 * Long, dense grains overlap by the dozen, so this does as little per
 * sample as it can: the window is looked up, and each grain reads one way
 * at a time between the source's ends rather than folding every read back
 * with mirror.
 */
export function mixGrains(
  grains: readonly Grain[],
  sampleRate: number,
  length: number,
  source = granularSource(sampleRate),
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  const last = source.length - 1;
  // A read past the end comes back by the start, so it repeats this often.
  const period = 2 * last;
  for (const grain of grains) {
    const first = Math.round(grain.startSeconds * sampleRate);
    const count = Math.max(2, Math.round(grain.durationSeconds * sampleRate));
    const window = hannWindow(count);
    const end = Math.min(length, first + count);
    const { level, rate } = grain;
    const from = Math.abs(grain.offset * last);
    let index = Math.max(0, first);
    // Each pass reads one way through the source until it reaches an end.
    while (index < end) {
      const step = index - first;
      const at = (from + step * rate) % period;
      const forward = at <= last;
      // Where this pass's read reaches the end it is heading to.
      const turn = forward ? last : period;
      const steps = Math.max(1, Math.ceil((turn - at) / rate));
      const stop = Math.min(end, index + steps);
      const sign = forward ? rate : -rate;
      let read = forward ? at : period - at;
      for (; index < stop; index++, read += sign) {
        const clamped = read < 0 ? 0 : read;
        const whole = clamped < last ? clamped | 0 : last - 1;
        const before = source[whole];
        const sample =
          before + (source[whole + 1] - before) * (clamped - whole);
        out[index] += level * window[index - first] * sample;
      }
    }
  }
  return out;
}

/**
 * `grains` mixed as mixGrains does, in a worker of their own, so the main
 * thread stays free however long they take, or here, where workers are
 * unavailable or the worker fails. Each mix gets its own worker, so a mix
 * started while another is still running, as when a knob is turned, does
 * not wait for it.
 */
export function mixGrainsOffThread(
  grains: Grain[],
  sampleRate: number,
  length: number,
): Promise<Float32Array<ArrayBuffer>> {
  const inline = () => mixGrains(grains, sampleRate, length);
  let worker: Worker;
  try {
    worker = new Worker(new URL("./granular.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return Promise.resolve(inline());
  }
  return new Promise((resolve) => {
    worker.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      resolve(inline());
    };
    worker.postMessage({
      grains,
      sampleRate,
      length,
    } satisfies GranularWorkerMessage);
  });
}

/** `samples` at `sampleRate` through `params`' lowpass filter. */
export async function filterGranular(
  samples: Float32Array<ArrayBuffer>,
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
  const mixed = await mixGrainsOffThread(grains, sampleRate, length);
  return {
    sampleRate,
    channels: [await filterGranular(mixed, params, sampleRate)],
  };
}
