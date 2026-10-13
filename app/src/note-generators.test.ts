import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MidiNote } from "./midi-clip.ts";
import {
  type Arpeggiator,
  applyNoteGenerators,
  arpeggiate,
  arpIndex,
  DEFAULT_ARPEGGIATOR,
  readNoteGenerators,
} from "./note-generators.ts";

// A C major triad held for a bar, struck at quarter 0.
const TRIAD: MidiNote[] = [
  { pitch: 60, start: 0, length: 4, velocity: 100 },
  { pitch: 64, start: 0, length: 4, velocity: 90 },
  { pitch: 67, start: 0, length: 4, velocity: 80 },
];

function arp(settings: Partial<Arpeggiator> = {}): Arpeggiator {
  return { ...DEFAULT_ARPEGGIATOR, rate: 1, ...settings };
}

const pitches = (notes: readonly MidiNote[]) => notes.map((note) => note.pitch);

describe("arpeggiate", () => {
  it("plays the held chord upward, one note per step", () => {
    const notes = arpeggiate(TRIAD, arp({ rate: 0.5 }));
    assert.deepEqual(pitches(notes), [60, 64, 67, 60, 64, 67, 60, 64]);
    assert.deepEqual(
      notes.map((note) => note.start),
      [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    );
    assert.ok(notes.every((note) => note.length === 0.5));
    // Each step keeps its held note's velocity.
    assert.deepEqual(
      notes.slice(0, 3).map((note) => note.velocity),
      [100, 90, 80],
    );
  });

  it("plays downward", () => {
    assert.deepEqual(
      pitches(arpeggiate(TRIAD, arp({ pattern: "down" }))),
      [67, 64, 60, 67],
    );
  });

  it("plays up then down without repeating the ends", () => {
    const notes = arpeggiate(TRIAD, arp({ pattern: "up-down", rate: 0.5 }));
    assert.deepEqual(pitches(notes), [60, 64, 67, 64, 60, 64, 67, 64]);
  });

  it("plays held notes in a random order that is the same every time", () => {
    const pattern = arp({ pattern: "random", rate: 0.125 });
    const notes = arpeggiate(TRIAD, pattern);
    assert.equal(notes.length, 32);
    assert.deepEqual(notes, arpeggiate(TRIAD, pattern));
    assert.ok(notes.every((note) => [60, 64, 67].includes(note.pitch)));
    // It is not just the up pattern.
    assert.notDeepEqual(
      pitches(notes),
      pitches(arpeggiate(TRIAD, { ...pattern, pattern: "up" })),
    );
    assert.equal(new Set(pitches(notes)).size, 3);
  });

  it("climbs the chord across octaves", () => {
    const notes = arpeggiate(TRIAD, arp({ octaves: 2, rate: 0.5 }));
    assert.deepEqual(pitches(notes), [60, 64, 67, 72, 76, 79, 60, 64]);
    assert.deepEqual(
      pitches(arpeggiate(TRIAD, arp({ octaves: 2, pattern: "down" }))),
      [79, 76, 72, 67],
    );
  });

  it("steps at the rate, a quarter to a thirty-second", () => {
    for (const rate of [1, 0.5, 0.25, 0.125] as const) {
      const notes = arpeggiate(TRIAD, arp({ rate }));
      assert.equal(notes.length, 4 / rate);
      assert.equal(notes[1].start - notes[0].start, rate);
    }
  });

  it("locks steps to the track's beat grid, not the note starts", () => {
    // A chord struck a quarter late on a clip whose quarter 0 sits half an
    // eighth after a grid line.
    const late = TRIAD.map((note) => ({ ...note, start: 1, length: 2 }));
    const notes = arpeggiate(late, arp({ rate: 0.5 }), 0.25);
    // Grid lines fall at clip quarters 0.25, 0.75, ...: the first one the
    // chord is held at is 1.25.
    assert.deepEqual(
      notes.map((note) => note.start),
      [1.25, 1.75, 2.25, 2.75],
    );
    // The last step ends when the chord is let go.
    assert.equal(notes[3].length, 0.25);
  });

  it("follows the held notes and restarts the pattern on each new chord", () => {
    const notes = arpeggiate(
      [
        { pitch: 60, start: 0, length: 2, velocity: 100 },
        { pitch: 64, start: 0, length: 2, velocity: 100 },
        // A gap, then a new chord.
        { pitch: 62, start: 3, length: 2, velocity: 100 },
        { pitch: 65, start: 3, length: 2, velocity: 100 },
      ],
      arp(),
    );
    assert.deepEqual(pitches(notes), [60, 64, 62, 65]);
    assert.deepEqual(
      notes.map((note) => note.start),
      [0, 1, 3, 4],
    );
  });

  it("keeps generated notes inside MIDI's range", () => {
    const notes = arpeggiate(
      [{ pitch: 120, start: 0, length: 4, velocity: 100 }],
      arp({ octaves: 3 }),
    );
    assert.deepEqual(pitches(notes), [120, 120, 120, 120]);
  });

  it("plays nothing for no notes", () => {
    assert.deepEqual(arpeggiate([], arp()), []);
  });
});

describe("arpIndex", () => {
  it("walks each pattern over a chord of one note", () => {
    for (const pattern of ["up", "down", "up-down", "random"] as const) {
      assert.equal(arpIndex(pattern, 5, 1), 0);
    }
  });
});

describe("applyNoteGenerators", () => {
  it("leaves the notes as they are without generators or when bypassed", () => {
    assert.equal(applyNoteGenerators(TRIAD, undefined), TRIAD);
    assert.equal(applyNoteGenerators(TRIAD, [arp({ enabled: false })]), TRIAD);
    assert.equal(applyNoteGenerators(TRIAD, [arp()]).length, 4);
  });
});

describe("readNoteGenerators", () => {
  it("reads arpeggiators, holding invalid settings to their defaults", () => {
    assert.deepEqual(
      readNoteGenerators([
        {
          kind: "arpeggiator",
          enabled: false,
          rate: 0.125,
          pattern: "down",
          octaves: 3,
        },
        { kind: "arpeggiator", rate: 3, pattern: "sideways", octaves: 9 },
        { kind: "chord" },
        null,
      ]),
      [
        {
          kind: "arpeggiator",
          enabled: false,
          rate: 0.125,
          pattern: "down",
          octaves: 3,
        },
        { ...DEFAULT_ARPEGGIATOR, octaves: 4 },
      ],
    );
  });

  it("reads nothing from a missing or empty chain", () => {
    assert.equal(readNoteGenerators(undefined), undefined);
    assert.equal(readNoteGenerators([{ kind: "chord" }]), undefined);
  });
});
