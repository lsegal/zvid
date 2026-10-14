// Plays a MIDI clip's notes through its Drum Rack. Each note on one of the
// rack's 16 pads (see fx/effects/drum-rack/banks.ts) plays the pad's sample
// once, from start to end, however long the note is held, at a level set
// by its velocity; notes off the pads are silent. The hats choke each
// other, as on a drum machine: a closed or pedal hat cuts off a ringing
// open hat. Samples are fetched and decoded only when a clip plays a pad,
// once per URL and sample rate, then mixed here, so preview and export
// hear the same performance.
import { padForNote } from "../fx/effects/drum-rack/banks.ts";
import type { DrumRackParams, MidiNote } from "../midi-clip.ts";
import type { DecodedAudio } from "./mix.ts";

// A hit's level at full velocity, leaving headroom for several at once.
export const DRUM_VOICE_LEVEL = 0.5;
// How long a choked hit takes to fade out, so it never clicks.
export const CHOKE_FADE_SECONDS = 0.005;

// Pads that cut each other off: closed hat, pedal hat and open hat.
export const DRUM_CHOKE_GROUPS: readonly (readonly number[])[] = [[6, 8, 10]];

/** A pad's hit, in seconds from the clip's content start. */
export type DrumHit = {
  pad: number;
  startSeconds: number;
  level: number;
  // When a later hit in its choke group cuts it off.
  chokeSeconds?: number;
};

function chokeGroupOf(pad: number) {
  return DRUM_CHOKE_GROUPS.findIndex((group) => group.includes(pad));
}

/**
 * The hits `notes` play at `bpm`, in seconds from the clip's content
 * start, leaving out notes off the pads and ones that start at or after
 * `endSeconds`, where the clip's audio ends.
 */
export function drumHits(
  notes: readonly MidiNote[],
  bpm: number,
  endSeconds = Number.POSITIVE_INFINITY,
): DrumHit[] {
  const secondsPerQuarter = 60 / bpm;
  const hits = notes
    .flatMap((note): DrumHit[] => {
      const pad = padForNote(note.pitch);
      const startSeconds = note.start * secondsPerQuarter;
      if (pad === undefined || startSeconds >= endSeconds) {
        return [];
      }
      return [
        { pad, startSeconds, level: (DRUM_VOICE_LEVEL * note.velocity) / 127 },
      ];
    })
    .sort((left, right) => left.startSeconds - right.startSeconds);
  hits.forEach((hit, index) => {
    const group = chokeGroupOf(hit.pad);
    if (group < 0) {
      return;
    }
    const next = hits
      .slice(index + 1)
      .find(
        (later) =>
          chokeGroupOf(later.pad) === group &&
          later.startSeconds > hit.startSeconds,
      );
    if (next) {
      hit.chokeSeconds = next.startSeconds;
    }
  });
  return hits;
}

/**
 * `hits` mixed into `length` samples at `sampleRate`, each its pad's
 * sample in `samples` (mono, at that rate); a pad without one is silent.
 */
export function mixDrumHits(
  hits: readonly DrumHit[],
  samples: readonly (Float32Array | undefined)[],
  sampleRate: number,
  length: number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  const fade = Math.max(1, Math.round(CHOKE_FADE_SECONDS * sampleRate));
  for (const hit of hits) {
    const sample = samples[hit.pad];
    if (!sample) {
      continue;
    }
    const first = Math.round(hit.startSeconds * sampleRate);
    const choke =
      hit.chokeSeconds === undefined
        ? Number.POSITIVE_INFINITY
        : Math.round(hit.chokeSeconds * sampleRate) - first;
    const end = Math.min(length - first, sample.length, choke + fade);
    for (let step = Math.max(0, -first); step < end; step++) {
      const gain = step < choke ? 1 : 1 - (step - choke) / fade;
      out[first + step] += hit.level * gain * sample[step];
    }
  }
  return out;
}

// Decoded samples, by sample rate and URL. A failed read is forgotten, so
// the next render tries again.
const decoded = new Map<
  string,
  Promise<Float32Array<ArrayBuffer> | undefined>
>();

// `buffer`'s channels averaged into one.
function downmix(buffer: AudioBuffer) {
  const out = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < out.length; index++) {
      out[index] += data[index] / buffer.numberOfChannels;
    }
  }
  return out;
}

async function decodeSample(url: string, sampleRate: number) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The sample could not be read (${response.status}).`);
  }
  const data = await response.arrayBuffer();
  // Decoding on a context at `sampleRate` resamples to it.
  const context = new OfflineAudioContext(1, 1, sampleRate);
  return downmix(await context.decodeAudioData(data));
}

/**
 * The sample at `url`, mono at `sampleRate`, fetched and decoded the first
 * time it is asked for; undefined when it can't be read.
 */
export function loadDrumSample(url: string, sampleRate: number) {
  const key = `${sampleRate}:${url}`;
  let entry = decoded.get(key);
  if (!entry) {
    entry = decodeSample(url, sampleRate).catch((error: unknown) => {
      decoded.delete(key);
      console.warn("[zvid] Could not load drum sample.", {
        url,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    });
    decoded.set(key, entry);
  }
  return entry;
}

/**
 * `notes` played through `params` at `bpm` and `sampleRate`, from the
 * clip's content start to `durationSeconds`, as decoded media. Only the
 * pads the notes hit load their samples.
 */
export async function renderDrumClip(
  notes: readonly MidiNote[],
  params: DrumRackParams,
  durationSeconds: number,
  bpm: number,
  sampleRate: number,
): Promise<DecodedAudio> {
  const length = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const hits = drumHits(notes, bpm, durationSeconds);
  const used = new Set(hits.map((hit) => hit.pad));
  const samples = await Promise.all(
    params.samples.map((url, pad) =>
      url && used.has(pad) ? loadDrumSample(url, sampleRate) : undefined,
    ),
  );
  return {
    sampleRate,
    channels: [mixDrumHits(hits, samples, sampleRate, length)],
  };
}
