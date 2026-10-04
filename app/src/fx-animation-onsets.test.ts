import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  clearReactiveOnsets,
  reactiveOnsets,
  recordHeardOnsets,
  recordReactiveOnsets,
  watchReactiveOnsets,
} from "./fx-animation-onsets.ts";
import { SILENT_AUDIO_BANDS } from "./fx-shaders/audio-bands.ts";

const times = () => reactiveOnsets().map((onset) => onset.time);

describe("reactive onsets", () => {
  beforeEach(clearReactiveOnsets);

  it("keeps the hits heard, in time order, across frames", () => {
    recordReactiveOnsets([{ time: 4.5, strength: 1 }], 5, 1);
    recordReactiveOnsets(
      [
        { time: 4.5, strength: 1 },
        { time: 5.25, strength: 0.5 },
      ],
      5.5,
      1,
    );
    recordReactiveOnsets([{ time: 1, strength: 1 }], 1.5, 1);
    assert.deepEqual(times(), [1, 4.5, 5.25]);
  });

  it("hears a span played again afresh", () => {
    recordReactiveOnsets(
      [
        { time: 2.2, strength: 1 },
        { time: 2.8, strength: 1 },
      ],
      3,
      1,
    );
    recordReactiveOnsets([{ time: 2.25, strength: 0.4 }], 3, 1);
    assert.deepEqual(reactiveOnsets(), [{ time: 2.25, strength: 0.4 }]);
  });

  it("records the preview's hits only while watched and playing", () => {
    const bands = {
      ...SILENT_AUDIO_BANDS,
      onsets: [{ secondsAgo: 0.5, strength: 1 }],
    };
    // At 120 bpm, quarter 4 is 2 seconds in.
    assert.equal(recordHeardOnsets(bands, 4, 120), bands);
    assert.deepEqual(times(), []);

    const stop = watchReactiveOnsets();
    recordHeardOnsets(bands, undefined, 120);
    assert.deepEqual(times(), []);
    recordHeardOnsets(bands, 4, 120);
    assert.deepEqual(times(), [1.5]);

    stop();
    stop();
    recordHeardOnsets({ ...bands, onsets: [] }, 4, 120);
    assert.deepEqual(times(), [1.5]);
  });
});
