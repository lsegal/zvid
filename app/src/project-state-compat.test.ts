import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  migrateLegacyMainAudio,
  stripClipSelectionFlags,
} from "./project-state-compat.ts";

describe("migrateLegacyMainAudio", () => {
  it("reads a legacy masterAudioId as mainAudioId", () => {
    assert.deepEqual(migrateLegacyMainAudio({ bpm: 120, masterAudioId: "a" }), {
      bpm: 120,
      mainAudioId: "a",
    });
  });

  it("prefers mainAudioId when both are present", () => {
    assert.deepEqual(
      migrateLegacyMainAudio({ mainAudioId: "new", masterAudioId: "old" }),
      { mainAudioId: "new" },
    );
  });

  it("returns current snapshots unchanged", () => {
    const snapshot = { bpm: 120, mainAudioId: "a" };
    assert.equal(migrateLegacyMainAudio(snapshot), snapshot);
  });
});

describe("stripClipSelectionFlags", () => {
  it("drops leftover selected flags from clips", () => {
    assert.deepEqual(
      stripClipSelectionFlags({
        bpm: 120,
        clips: [
          { id: "a", selected: true },
          { id: "b", selected: false },
          { id: "c" },
        ],
      }),
      { bpm: 120, clips: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    );
  });

  it("returns snapshots without flags unchanged", () => {
    const snapshot = { bpm: 120, clips: [{ id: "a" }] };
    assert.equal(stripClipSelectionFlags(snapshot), snapshot);
  });
});
