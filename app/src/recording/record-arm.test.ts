import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  disarmAllTracks,
  getArmedTrackIds,
  isTrackArmed,
  pruneArmedTracks,
  setTrackArmed,
  subscribeArmedTracks,
  toggleTrackArmed,
} from "./record-arm.ts";

afterEach(disarmAllTracks);

describe("record arm", () => {
  it("toggles a track's armed state", () => {
    assert.equal(isTrackArmed("a"), false);
    toggleTrackArmed("a");
    assert.equal(isTrackArmed("a"), true);
    toggleTrackArmed("a");
    assert.equal(isTrackArmed("a"), false);
  });

  it("arms several tracks at once", () => {
    toggleTrackArmed("a");
    toggleTrackArmed("b");
    setTrackArmed("c", true);
    assert.deepEqual([...getArmedTrackIds()], ["a", "b", "c"]);
    setTrackArmed("b", false);
    assert.deepEqual([...getArmedTrackIds()], ["a", "c"]);
  });

  it("disarms tracks that were removed", () => {
    toggleTrackArmed("a");
    toggleTrackArmed("b");
    pruneArmedTracks(["b", "c"]);
    assert.deepEqual([...getArmedTrackIds()], ["b"]);
  });

  it("notifies listeners only when the armed set changes", () => {
    let calls = 0;
    const unsubscribe = subscribeArmedTracks(() => calls++);
    const before = getArmedTrackIds();
    setTrackArmed("a", true);
    assert.equal(calls, 1);
    assert.notEqual(getArmedTrackIds(), before);
    setTrackArmed("a", true);
    pruneArmedTracks(["a"]);
    assert.equal(calls, 1);
    pruneArmedTracks([]);
    assert.equal(calls, 2);
    unsubscribe();
    setTrackArmed("a", true);
    assert.equal(calls, 2);
  });
});
