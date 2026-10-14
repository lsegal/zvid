// A MIDI clip is a source clip that carries notes instead of media. It
// plays them through the instrument on its own stack, a Synth, a Granular
// or a Drum Rack (see midi-effects.ts and audio-mix/synth.ts), in preview and
// export alike. A clip without `notes` is not a MIDI clip: MIDI
// clips imported from a Live set stay media-less placeholders that video can
// be linked to, since the import does not read their notes.

/**
 * A note of a MIDI clip. `start` and `length` are in quarter notes, `start`
 * from the clip's content start, so the clip's notes follow the tempo and
 * trimming its start hides the notes before the new start. `pitch` is a MIDI
 * note number, 69 being A4 at 440 Hz, and `velocity` runs from 1 to 127.
 */
export type MidiNote = {
  pitch: number;
  start: number;
  length: number;
  velocity: number;
};

export const SYNTH_WAVES = ["sine", "triangle", "sawtooth", "square"] as const;

export type SynthWave = (typeof SYNTH_WAVES)[number];

/**
 * A Synth effect's settings: an oscillator through a lowpass filter and an ADSR
 * envelope for each note. `octave` shifts every note by whole octaves and
 * `detune` by cents; `cutoff` is in Hz and `resonance` is the filter's Q.
 * `attack`, `decay` and `release` are in seconds and `sustain` is a level
 * from 0 to 1 of the note's peak.
 */
export type SynthParams = {
  wave: SynthWave;
  octave: number;
  detune: number;
  cutoff: number;
  resonance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
};

export const DEFAULT_SYNTH_PARAMS: SynthParams = {
  wave: "sawtooth",
  octave: 0,
  detune: 0,
  cutoff: 2400,
  resonance: 1,
  attack: 0.005,
  decay: 0.15,
  sustain: 0.6,
  release: 0.2,
};

// The range each numeric parameter is held to.
export const SYNTH_PARAM_RANGES: Record<
  Exclude<keyof SynthParams, "wave">,
  { min: number; max: number }
> = {
  octave: { min: -3, max: 3 },
  detune: { min: -1200, max: 1200 },
  cutoff: { min: 20, max: 20_000 },
  resonance: { min: 0.0001, max: 30 },
  attack: { min: 0, max: 10 },
  decay: { min: 0, max: 10 },
  sustain: { min: 0, max: 1 },
  release: { min: 0, max: 10 },
};

/**
 * A Granular effect's settings: each note plays a cloud of short grains of
 * a built-in source sound (see audio-mix/granular.ts). `grainSize` is each
 * grain's length in seconds and `density` how many start each second;
 * `transpose` shifts every note by semitones; `position` is where in the
 * source the grains read, from 0 to 1, and `spray` how far from it, and
 * from their even spacing, they stray, from 0 to 1. `attack` and `release`
 * shape the cloud in seconds; `cutoff` and `resonance` are the lowpass
 * filter's, as the Synth's.
 */
export type GranularParams = {
  grainSize: number;
  density: number;
  transpose: number;
  position: number;
  spray: number;
  attack: number;
  release: number;
  cutoff: number;
  resonance: number;
};

export const DEFAULT_GRANULAR_PARAMS: GranularParams = {
  grainSize: 0.08,
  density: 30,
  transpose: 0,
  position: 0.3,
  spray: 0.2,
  attack: 0.02,
  release: 0.3,
  cutoff: 6000,
  resonance: 1,
};

// The range each Granular parameter is held to.
export const GRANULAR_PARAM_RANGES: Record<
  keyof GranularParams,
  { min: number; max: number }
> = {
  grainSize: { min: 0.01, max: 0.5 },
  density: { min: 1, max: 100 },
  transpose: { min: -24, max: 24 },
  position: { min: 0, max: 1 },
  spray: { min: 0, max: 1 },
  attack: { min: 0, max: 10 },
  release: { min: 0, max: 10 },
  cutoff: { min: 20, max: 20_000 },
  resonance: { min: 0.0001, max: 30 },
};

/**
 * What a Drum Rack plays: for each of its pads, pad 1 first, the URL of the
 * one-shot sample it plays, or null for a pad that stays silent because its
 * sample's media is offline (see fx/effects/drum-rack/drum-media.ts).
 */
export type DrumRackParams = {
  samples: readonly (string | null)[];
};

/** The instrument a MIDI clip plays its notes through. */
export type MidiInstrument =
  | { kind: "synth"; params: SynthParams }
  | { kind: "granular"; params: GranularParams }
  | { kind: "drums"; params: DrumRackParams };

/** The instrument a MIDI clip without one auditions its notes with. */
export const DEFAULT_INSTRUMENT: MidiInstrument = {
  kind: "synth",
  params: DEFAULT_SYNTH_PARAMS,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * The notes of a session clip's `notes`, read from parsed JSON: notes that
 * are not objects or lack a finite pitch, start or length are dropped, the
 * rest held to MIDI's ranges and sorted by start. Undefined when `value` is
 * not an array, as for a clip that is not a MIDI clip.
 */
export function readMidiNotes(value: unknown): MidiNote[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .flatMap((note): MidiNote[] => {
      if (
        !note ||
        !isFiniteNumber(note.pitch) ||
        !isFiniteNumber(note.start) ||
        !isFiniteNumber(note.length) ||
        note.length <= 0
      ) {
        return [];
      }
      return [
        {
          pitch: clamp(Math.round(note.pitch), 0, 127),
          start: Math.max(0, note.start),
          length: note.length,
          velocity: isFiniteNumber(note.velocity)
            ? clamp(Math.round(note.velocity), 1, 127)
            : 100,
        },
      ];
    })
    .sort(
      (left, right) => left.start - right.start || left.pitch - right.pitch,
    );
}

/**
 * The synth parameters an older session saved on a source track, read from
 * parsed JSON, any missing or invalid one taking its default and the rest
 * held to their ranges. Undefined when `value` is not an object, as for a
 * track that never set its synth.
 */
export function readSynthParams(value: unknown): SynthParams | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const params: SynthParams = { ...DEFAULT_SYNTH_PARAMS };
  if (SYNTH_WAVES.includes(record.wave as SynthWave)) {
    params.wave = record.wave as SynthWave;
  }
  for (const [key, { min, max }] of Object.entries(SYNTH_PARAM_RANGES)) {
    const field = record[key];
    if (isFiniteNumber(field)) {
      params[key as keyof typeof SYNTH_PARAM_RANGES] = clamp(field, min, max);
    }
  }
  params.octave = Math.round(params.octave);
  return params;
}
