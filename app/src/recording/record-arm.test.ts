import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getArmedTracks,
  isTrackArmed,
  pruneArmedTracks,
  setTrackArmed,
  toggleTrackArmed,
} from "./record-arm.ts";

describe("record arm", () => {
  it("arms, disarms and prunes source tracks", () => {
    setTrackArmed("track-1", true);
    toggleTrackArmed("track-2");
    assert.equal(isTrackArmed("track-1"), true);
    assert.equal(isTrackArmed("track-2"), true);

    const before = getArmedTracks();
    setTrackArmed("track-1", true);
    assert.equal(getArmedTracks(), before, "an unchanged arm keeps its set");

    toggleTrackArmed("track-2");
    assert.equal(isTrackArmed("track-2"), false);

    pruneArmedTracks(["track-3"]);
    assert.equal(getArmedTracks().size, 0);
  });
});
