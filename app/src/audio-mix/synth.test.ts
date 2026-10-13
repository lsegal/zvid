import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SYNTH_PARAMS, type MidiNote } from "../midi-clip.ts";
import {
  noteFrequency,
  SYNTH_VOICE_LEVEL,
  synthClipOf,
  synthEnvelope,
  synthMediaId,
  synthVoices,
} from "./synth.ts";

const ADSR = { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 };

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

function assertPoints(
  actual: { seconds: number; level: number }[],
  expected: [number, number][],
) {
  assert.equal(actual.length, expected.length);
  actual.forEach((point, index) => {
    close(point.seconds, expected[index][0]);
    close(point.level, expected[index][1]);
  });
}

describe("noteFrequency", () => {
  it("tunes A4 to 440 Hz and shifts by octaves", () => {
    close(noteFrequency(69), 440);
    close(noteFrequency(81), 880);
    close(noteFrequency(69, -1), 220);
    close(noteFrequency(60), 261.6255653005986);
  });
});

describe("synthEnvelope", () => {
  it("attacks, decays to the sustain level, holds and releases", () => {
    assertPoints(synthEnvelope(ADSR, 1, 2, 3), [
      [2, 0],
      [2.1, 1],
      [2.3, 0.5],
      [3, 0.5],
      [3.3, 0],
    ]);
  });

  it("releases a note let go during its decay from where it got to", () => {
    assertPoints(synthEnvelope(ADSR, 1, 0, 0.2), [
      [0, 0],
      [0.1, 1],
      [0.2, 0.75],
      [0.5, 0],
    ]);
  });

  it("releases a note let go during its attack from where it got to", () => {
    assertPoints(synthEnvelope(ADSR, 0.8, 0, 0.05), [
      [0, 0],
      [0.05, 0.4],
      [0.35, 0],
    ]);
  });
});

describe("synthVoices", () => {
  const notes: MidiNote[] = [
    { pitch: 69, start: 0, length: 1, velocity: 127 },
    { pitch: 57, start: 2, length: 0.5, velocity: 64 },
    { pitch: 60, start: 8, length: 1, velocity: 100 },
  ];
  const params = { ...DEFAULT_SYNTH_PARAMS, ...ADSR, octave: 1 };

  it("places each note in seconds at the tempo", () => {
    const voices = synthVoices(notes, params, 120);
    assert.deepEqual(
      voices.map((voice) => voice.startSeconds),
      [0, 1, 4],
    );
    close(voices[0].frequency, 880);
    close(voices[1].frequency, 440);
    // Released half a second in, silent 0.3 seconds later.
    close(voices[0].stopSeconds, 0.8);
    close(voices[1].stopSeconds, 1.55);
  });

  it("scales each note's peak by its velocity", () => {
    const [loud, soft] = synthVoices(notes, params, 120);
    close(loud.envelope[1].level, SYNTH_VOICE_LEVEL);
    close(soft.envelope[1].level, (SYNTH_VOICE_LEVEL * 64) / 127);
  });

  it("follows the tempo", () => {
    assert.deepEqual(
      synthVoices(notes, params, 60).map((voice) => voice.startSeconds),
      [0, 2, 8],
    );
  });

  it("leaves out notes starting after the clip's audio ends", () => {
    assert.equal(synthVoices(notes, params, 120, 4).length, 2);
  });
});

describe("synthMediaId", () => {
  const notes: MidiNote[] = [{ pitch: 60, start: 0, length: 1, velocity: 100 }];
  const synth = synthClipOf(notes, undefined, 4);

  it("plays a track without a synth through the default one", () => {
    assert.equal(synth.params, DEFAULT_SYNTH_PARAMS);
  });

  it("changes with what the clip renders", () => {
    const id = synthMediaId("span", synth, 120);
    assert.equal(
      synthMediaId("span", synthClipOf(notes, undefined, 4), 120),
      id,
    );
    for (const other of [
      synthMediaId("other", synth, 120),
      synthMediaId("span", synth, 90),
      synthMediaId(
        "span",
        synthClipOf([{ ...notes[0], pitch: 62 }], undefined, 4),
        120,
      ),
      synthMediaId(
        "span",
        synthClipOf(notes, { ...DEFAULT_SYNTH_PARAMS, cutoff: 300 }, 4),
        120,
      ),
      synthMediaId("span", synthClipOf(notes, undefined, 5), 120),
    ]) {
      assert.notEqual(other, id);
    }
  });
});
