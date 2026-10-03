import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  disarmAllTracks,
  getArmedTracks,
  isTrackArmed,
  setTrackArmed,
  subscribeRecordArm,
  toggleTrackArmed,
} from "./record-arm.ts";

describe("record arm store", () => {
  beforeEach(() => disarmAllTracks());

  it("arms and disarms tracks independently", () => {
    setTrackArmed("track-1", true);
    toggleTrackArmed("track-2");
    assert.equal(isTrackArmed("track-1"), true);
    assert.equal(isTrackArmed("track-2"), true);
    toggleTrackArmed("track-1");
    assert.equal(isTrackArmed("track-1"), false);
    assert.deepEqual([...getArmedTracks()], ["track-2"]);
  });

  it("tells every arm button when a track's state changes", () => {
    const calls: boolean[] = [];
    const unsubscribe = subscribeRecordArm(() =>
      calls.push(isTrackArmed("track-1")),
    );
    setTrackArmed("track-1", true);
    // Setting the state it already has changes nothing.
    setTrackArmed("track-1", true);
    setTrackArmed("track-1", false);
    unsubscribe();
    setTrackArmed("track-1", true);
    assert.deepEqual(calls, [true, false]);
  });

  it("replaces the snapshot on each change", () => {
    const before = getArmedTracks();
    setTrackArmed("track-1", true);
    assert.notEqual(getArmedTracks(), before);
    assert.equal(before.has("track-1"), false);
  });
});
