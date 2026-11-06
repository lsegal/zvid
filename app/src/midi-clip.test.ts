import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SYNTH_PARAMS,
  expressionSampleAtStart,
  expressionValueAt,
  readMidiNotes,
  readSynthParams,
  shiftedExpression,
  withNoteStartMoved,
} from "./midi-clip.ts";

describe("readMidiNotes", () => {
  it("reads no notes from a clip that is not a MIDI clip", () => {
    assert.equal(readMidiNotes(undefined), undefined);
    assert.equal(readMidiNotes({}), undefined);
  });

  it("keeps an empty MIDI clip empty", () => {
    assert.deepEqual(readMidiNotes([]), []);
  });

  it("sorts notes by start and holds them to MIDI's ranges", () => {
    assert.deepEqual(
      readMidiNotes([
        { pitch: 200.4, start: 2, length: 1, velocity: 300 },
        { pitch: 60, start: -1, length: 0.5, velocity: 0 },
        { pitch: 62, start: 1, length: 0.25 },
      ]),
      [
        { pitch: 60, start: 0, length: 0.5, velocity: 1 },
        { pitch: 62, start: 1, length: 0.25, velocity: 100 },
        { pitch: 127, start: 2, length: 1, velocity: 127 },
      ],
    );
  });

  it("drops notes it cannot place", () => {
    assert.deepEqual(
      readMidiNotes([
        null,
        "C4",
        { pitch: 60, start: 0 },
        { pitch: 60, start: 0, length: 0 },
        { pitch: Number.NaN, start: 0, length: 1 },
        { pitch: 60, start: 0, length: 1, velocity: 64 },
      ]),
      [{ pitch: 60, start: 0, length: 1, velocity: 64 }],
    );
  });
});

describe("readSynthParams", () => {
  it("reads no synth from a track that never set one", () => {
    assert.equal(readSynthParams(undefined), undefined);
    assert.equal(readSynthParams([]), undefined);
  });

  it("fills in missing parameters with their defaults", () => {
    assert.deepEqual(readSynthParams({ wave: "sine", cutoff: 500 }), {
      ...DEFAULT_SYNTH_PARAMS,
      wave: "sine",
      cutoff: 500,
    });
  });

  it("holds parameters to their ranges and ignores invalid ones", () => {
    assert.deepEqual(
      readSynthParams({
        wave: "noise",
        octave: 1.6,
        cutoff: 1e6,
        sustain: -2,
        release: "long",
      }),
      {
        ...DEFAULT_SYNTH_PARAMS,
        octave: 2,
        cutoff: 20_000,
        sustain: 0,
      },
    );
  });
});

describe("a note's expression", () => {
  const curve = [
    { at: 1, value: 2 },
    { at: 2, value: 4 },
  ];

  it("ramps between its points and holds beyond them", () => {
    assert.equal(expressionValueAt(curve, 0), 2);
    assert.equal(expressionValueAt(curve, 1.5), 3);
    assert.equal(expressionValueAt(curve, 2), 4);
    assert.equal(expressionValueAt(curve, 3), 4);
  });

  it("survives a session's JSON", () => {
    const note = {
      pitch: 60,
      start: 0,
      length: 1,
      velocity: 100,
      expression: {
        bend: [
          { at: 0, value: 0 },
          { at: 0.5, value: 2 },
        ],
        pressure: [{ at: 0, value: 0.5 }],
        timbre: [{ at: 0.25, value: 1 }],
      },
    };
    assert.deepEqual(readMidiNotes(JSON.parse(JSON.stringify([note]))), [note]);
  });

  it("is absent from a note without one", () => {
    const [note] =
      readMidiNotes([{ pitch: 60, start: 0, length: 1, velocity: 100 }]) ?? [];
    assert.equal("expression" in note, false);
  });

  it("is read defensively: bad points go and the rest hold to their ranges", () => {
    const [note] =
      readMidiNotes([
        {
          pitch: 60,
          start: 0,
          length: 1,
          velocity: 100,
          expression: {
            bend: [{ at: 1, value: 999 }, { at: 0, value: -999 }, "nonsense"],
            pressure: [{ at: "soon", value: 1 }],
            timbre: "bright",
          },
        },
      ]) ?? [];
    assert.deepEqual(note.expression, {
      bend: [
        { at: 0, value: -192 },
        { at: 1, value: 192 },
      ],
    });
  });

  it("is dropped when nothing in it can be read", () => {
    const [note] =
      readMidiNotes([
        {
          pitch: 60,
          start: 0,
          length: 1,
          velocity: 100,
          expression: { bend: [] },
        },
      ]) ?? [];
    assert.equal("expression" in note, false);
  });

  it("gives its values at the note's start", () => {
    assert.deepEqual(expressionSampleAtStart({ pressure: curve }), {
      bend: 0,
      pressure: 2,
    });
  });

  it("stays where it was in time when the note's start moves", () => {
    assert.deepEqual(shiftedExpression({ bend: curve }, 1.5), {
      bend: [
        { at: 0, value: 3 },
        { at: 0.5, value: 4 },
      ],
    });
    const moved = withNoteStartMoved(
      {
        pitch: 60,
        start: 4,
        length: 4,
        velocity: 100,
        expression: { bend: curve },
      },
      1.5,
    );
    assert.equal(moved.start, 5.5);
    assert.equal(moved.length, 2.5);
    assert.equal(moved.expression?.bend?.[0].value, 3);
  });
});
