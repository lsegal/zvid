import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { migrateLegacyMainAudio } from "./project-state-compat.ts";

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
