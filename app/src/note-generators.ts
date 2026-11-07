// Note generators: MIDI effects, such as the Arpeggiator, on a MIDI clip's
// stack that turn its notes into the notes its Synth plays. The mix runs a
// clip's notes through them before rendering it (see audio-mix/resolve.ts
// and midi-effects.ts), so preview and export hear the same performance. A
// disabled generator passes its notes through unchanged.
import {
  clipModulator,
  type MidiModulation,
  type MidiModulationClock,
} from "./audio-mix/midi-modulation.ts";
import { type MidiNote, shiftedExpression } from "./midi-clip.ts";

export const ARP_RATES = [1, 0.5, 0.25, 0.125] as const;
export const ARP_PATTERNS = ["up", "down", "up-down", "random"] as const;
export const ARP_MAX_OCTAVES = 4;
export const ARP_RATE_KEY = "Rate";
export const ARP_OCTAVES_KEY = "Octaves";

// A step's length in quarter notes: a quarter, an eighth, a sixteenth or a
// thirty-second.
export type ArpRate = (typeof ARP_RATES)[number];
export type ArpPattern = (typeof ARP_PATTERNS)[number];

/**
 * An arpeggiator: on each step of `rate` quarters, locked to the source
 * track's beat grid, it plays one of the notes held at that step, walking
 * them in `pattern` order across `octaves` octaves from the lowest.
 */
export type Arpeggiator = {
  kind: "arpeggiator";
  enabled: boolean;
  rate: ArpRate;
  pattern: ArpPattern;
  octaves: number;
  // Moves its Rate and Octaves from step to step.
  modulation?: MidiModulation;
};

export type NoteGenerator = Arpeggiator;

export const DEFAULT_ARPEGGIATOR: Arpeggiator = {
  kind: "arpeggiator",
  enabled: true,
  rate: 0.25,
  pattern: "up",
  octaves: 1,
};

// How far before a grid line a time still counts as on it, absorbing the
// rounding of quarters converted from seconds.
const GRID_EPSILON = 1e-6;

/** The session's clock and tempo, which a generator's modulation follows. */
export type NoteGeneratorClock = MidiModulationClock & { bpm: number };

/**
 * The note generators of an older session track's `noteGenerators`, read
 * from parsed JSON: entries of an unknown kind are dropped and an arpeggiator's
 * invalid settings take their defaults. Undefined when `value` is not an
 * array or nothing in it is a generator.
 */
export function readNoteGenerators(
  value: unknown,
): NoteGenerator[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const generators = value.flatMap((entry): NoteGenerator[] => {
    if (!entry || typeof entry !== "object" || entry.kind !== "arpeggiator") {
      return [];
    }
    const octaves = Number.isFinite(entry.octaves)
      ? Math.round(entry.octaves)
      : DEFAULT_ARPEGGIATOR.octaves;
    return [
      {
        kind: "arpeggiator",
        enabled: entry.enabled !== false,
        rate: ARP_RATES.includes(entry.rate)
          ? entry.rate
          : DEFAULT_ARPEGGIATOR.rate,
        pattern: ARP_PATTERNS.includes(entry.pattern)
          ? entry.pattern
          : DEFAULT_ARPEGGIATOR.pattern,
        octaves: Math.min(ARP_MAX_OCTAVES, Math.max(1, octaves)),
      },
    ];
  });
  return generators.length ? generators : undefined;
}

// A stable pseudo-random index below `count` for `step` (a 32-bit integer
// hash), so a random arpeggio plays the same in preview and export.
function randomIndex(step: number, count: number) {
  let hash = Math.imul(step ^ 0x9e3779b9, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % count;
}

/**
 * The index into a held chord of `count` notes, sorted from lowest, that
 * `pattern` plays on the `index`th step since the chord was struck.
 */
export function arpIndex(pattern: ArpPattern, index: number, count: number) {
  if (pattern === "up") {
    return index % count;
  }
  if (pattern === "down") {
    return count - 1 - (index % count);
  }
  if (pattern === "up-down") {
    // Up then back down without repeating the top or bottom note.
    const cycle = Math.max(1, 2 * count - 2);
    const position = index % cycle;
    return position < count ? position : cycle - position;
  }
  return randomIndex(index, count);
}

/**
 * The notes `arp` plays for held `notes`. `gridOffsetQ` is where the notes'
 * quarter 0 falls on the track's beat grid, so steps land on the grid
 * wherever the clip starts. Each step plays the note its pattern picks from
 * those held at the step, at that note's velocity, for the step or until
 * the note is let go if sooner. The pattern restarts whenever the held
 * chord changes. With `clock`, its modulation picks each step's Rate and
 * Octaves as the step lands, so a faster Rate carries on from the next line of
 * its own finer grid.
 */
export function arpeggiate(
  notes: readonly MidiNote[],
  arp: Arpeggiator,
  gridOffsetQ = 0,
  clock?: NoteGeneratorClock,
): MidiNote[] {
  if (!notes.length) {
    return [];
  }
  const modulator =
    clock && clipModulator(arp.modulation, notes, clock.bpm, clock);
  const secondsPerQuarter = clock ? 60 / clock.bpm : 0;
  const rateAt = (quarters: number): number =>
    modulator
      ? ARP_RATES[
          Math.round(
            modulator.value(
              ARP_RATE_KEY,
              ARP_RATES.indexOf(arp.rate),
              quarters * secondsPerQuarter,
            ),
          )
        ]
      : arp.rate;
  const octavesAt = (quarters: number) =>
    modulator
      ? Math.round(
          modulator.value(
            ARP_OCTAVES_KEY,
            arp.octaves,
            quarters * secondsPerQuarter,
          ),
        )
      : arp.octaves;
  const first = Math.min(...notes.map((note) => note.start));
  const last = Math.max(...notes.map((note) => note.start + note.length));
  const firstStep = rateAt(first);
  // The first grid line at or after the first note, in clip quarters. The
  // ceiling of a tiny negative is -0, which `+ 0` makes 0.
  let time =
    Math.ceil((first + gridOffsetQ) / firstStep - GRID_EPSILON) * firstStep -
    gridOffsetQ +
    0;
  // The step's own length, and the time of the step after it.
  const advance = (step: number) =>
    modulator
      ? (Math.floor((time + gridOffsetQ) / step + GRID_EPSILON) + 1) * step -
        gridOffsetQ
      : time + step;
  const played: MidiNote[] = [];
  let chordKey = "";
  let index = 0;
  while (time < last - GRID_EPSILON) {
    const step = rateAt(time);
    const held = notes
      .filter(
        (note) =>
          note.start <= time + GRID_EPSILON &&
          note.start + note.length > time + GRID_EPSILON,
      )
      .sort((left, right) => left.pitch - right.pitch);
    if (!held.length) {
      chordKey = "";
      time = advance(step);
      continue;
    }
    const key = held.map((note) => note.pitch).join(",");
    if (key !== chordKey) {
      chordKey = key;
      index = 0;
    }
    const ladder = Array.from({ length: octavesAt(time) }, (_, octave) =>
      held.map((note) => ({ note, pitch: note.pitch + 12 * octave })),
    )
      .flat()
      .filter(({ pitch }) => pitch <= 127);
    const { note, pitch } = ladder[arpIndex(arp.pattern, index, ladder.length)];
    index++;
    played.push({
      pitch,
      start: time,
      length: Math.min(step, note.start + note.length - time),
      velocity: note.velocity,
      ...(note.expression
        ? { expression: shiftedExpression(note.expression, time - note.start) }
        : {}),
    });
    time = advance(step);
  }
  return played;
}

/**
 * The notes a track whose chain is `generators` plays for a clip's `notes`,
 * each enabled generator transforming the previous one's output in order, and
 * their modulation following `clock`.
 */
export function applyNoteGenerators(
  notes: readonly MidiNote[],
  generators: readonly NoteGenerator[] | undefined,
  gridOffsetQ = 0,
  clock?: NoteGeneratorClock,
): readonly MidiNote[] {
  return (generators ?? []).reduce<readonly MidiNote[]>(
    (current, generator) =>
      generator.enabled
        ? arpeggiate(current, generator, gridOffsetQ, clock)
        : current,
    notes,
  );
}
