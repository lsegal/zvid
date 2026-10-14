// Plays a MIDI clip's notes through its Synth effect. Each note is a voice:
// an oscillator through a lowpass filter into a gain shaped by the synth's
// ADSR envelope. The voices render in an OfflineAudioContext into the
// clip's audio, from its content start to its source window's end, which
// the mix then reads like decoded media: the preview plays it from the
// clip's position under the playhead, through seeks and loops, and export
// renders it into the mix, so both hear the same performance.
import type { MidiNote, SynthParams } from "../midi-clip.ts";
import type { DecodedAudio } from "./mix.ts";

// What a MIDI clip in the mix plays: its notes through its Synth,
// rendered `durationSeconds` long from its content start.
export type SynthClip = {
  notes: readonly MidiNote[];
  params: SynthParams;
  durationSeconds: number;
};

// A note's peak level at full velocity, leaving headroom for chords.
export const SYNTH_VOICE_LEVEL = 0.25;
// The shortest attack and release, so a note never clicks on or off.
const MIN_RAMP_SECONDS = 0.002;

/** A point of a voice's gain envelope, ramped to linearly. */
export type EnvelopePoint = { seconds: number; level: number };

/** A note as the synth plays it, in seconds from the clip's content start. */
export type SynthVoice = {
  frequency: number;
  startSeconds: number;
  // When its gain is back to 0 and its oscillator stops.
  stopSeconds: number;
  envelope: EnvelopePoint[];
};

/** The frequency `pitch` sounds at, `octave` octaves up. */
export function noteFrequency(pitch: number, octave = 0) {
  return 440 * 2 ** ((pitch - 69) / 12 + octave);
}

/**
 * The gain envelope of a note at `peak` held from `start` to `off`: up to
 * the peak over the attack, down to the sustain level over the decay, held
 * there until the note is released at `off`, then down to 0 over the
 * release. A note released before its decay ends is released from the
 * level it had reached.
 */
export function synthEnvelope(
  params: Pick<SynthParams, "attack" | "decay" | "sustain" | "release">,
  peak: number,
  start: number,
  off: number,
): EnvelopePoint[] {
  const attack = Math.max(MIN_RAMP_SECONDS, params.attack);
  const release = Math.max(MIN_RAMP_SECONDS, params.release);
  const sustain = peak * params.sustain;
  const peakAt = start + attack;
  const sustainAt = peakAt + params.decay;
  const points: EnvelopePoint[] = [{ seconds: start, level: 0 }];
  if (off <= peakAt) {
    points.push({ seconds: off, level: (peak * (off - start)) / attack });
  } else {
    points.push({ seconds: peakAt, level: peak });
    if (off <= sustainAt) {
      const decayed = params.decay > 0 ? (off - peakAt) / params.decay : 1;
      points.push({ seconds: off, level: peak + (sustain - peak) * decayed });
    } else {
      points.push({ seconds: sustainAt, level: sustain });
      points.push({ seconds: off, level: sustain });
    }
  }
  const released = points[points.length - 1];
  points.push({ seconds: released.seconds + release, level: 0 });
  return points;
}

/**
 * The voices `notes` play through `params` at `bpm`, in seconds from the
 * clip's content start, leaving out notes that start at or after
 * `endSeconds`, where the clip's audio ends.
 */
export function synthVoices(
  notes: readonly MidiNote[],
  params: SynthParams,
  bpm: number,
  endSeconds = Number.POSITIVE_INFINITY,
): SynthVoice[] {
  const secondsPerQuarter = 60 / bpm;
  return notes.flatMap((note) => {
    const startSeconds = note.start * secondsPerQuarter;
    if (startSeconds >= endSeconds || note.length <= 0) {
      return [];
    }
    const envelope = synthEnvelope(
      params,
      (SYNTH_VOICE_LEVEL * note.velocity) / 127,
      startSeconds,
      startSeconds + note.length * secondsPerQuarter,
    );
    return [
      {
        frequency: noteFrequency(note.pitch, params.octave),
        startSeconds,
        stopSeconds: envelope[envelope.length - 1].seconds,
        envelope,
      },
    ];
  });
}

// A short, stable hash of `text` (32-bit FNV-1a), in base 36.
function hashText(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The media id the mix plays `synth` as, for the source clip `spanId`, at
 * `bpm`: it changes whenever what the clip renders does, so the preview and
 * the caches of rendered audio render it again.
 */
export function synthMediaId(spanId: string, synth: SynthClip, bpm: number) {
  return `synth:${spanId}:${hashText(JSON.stringify([synth, bpm]))}`;
}

/**
 * `synth`'s voices rendered at `bpm` and `sampleRate`, from its content
 * start to its end, as decoded media.
 */
export async function renderSynthClip(
  synth: SynthClip,
  bpm: number,
  sampleRate: number,
): Promise<DecodedAudio> {
  const length = Math.max(1, Math.ceil(synth.durationSeconds * sampleRate));
  const context = new OfflineAudioContext(1, length, sampleRate);
  const { params } = synth;
  for (const voice of synthVoices(
    synth.notes,
    params,
    bpm,
    synth.durationSeconds,
  )) {
    const oscillator = context.createOscillator();
    oscillator.type = params.wave;
    oscillator.frequency.value = voice.frequency;
    oscillator.detune.value = params.detune;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = params.cutoff;
    filter.Q.value = params.resonance;
    const gain = context.createGain();
    gain.gain.value = 0;
    const [first, ...rest] = voice.envelope;
    gain.gain.setValueAtTime(first.level, first.seconds);
    for (const point of rest) {
      gain.gain.linearRampToValueAtTime(point.level, point.seconds);
    }
    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.start(voice.startSeconds);
    oscillator.stop(voice.stopSeconds);
  }
  const rendered = await context.startRendering();
  return {
    sampleRate: rendered.sampleRate,
    channels: [rendered.getChannelData(0).slice()],
  };
}
