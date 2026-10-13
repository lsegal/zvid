import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SYNTH_PARAMS,
  readMidiNotes,
  readSynthParams,
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
