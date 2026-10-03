import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearArmedTracks,
  getArmedTrackIds,
  pruneArmedTracks,
  setTrackArmed,
  subscribeArmedTracks,
  toggleTrackArmed,
} from "./record-arm.ts";
import {
  canPressRecord,
  playbackEndsRecording,
  pressRecord,
} from "./record-transport.ts";

describe("record arm", () => {
  it("arms and disarms tracks, notifying subscribers", () => {
    clearArmedTracks();
    let notified = 0;
    const unsubscribe = subscribeArmedTracks(() => {
      notified += 1;
    });
    toggleTrackArmed("a");
    setTrackArmed("b", true);
    setTrackArmed("b", true);
    assert.deepEqual([...getArmedTrackIds()], ["a", "b"]);
    assert.equal(notified, 2);

    const before = getArmedTrackIds();
    toggleTrackArmed("a");
    assert.notEqual(getArmedTrackIds(), before, "the set is replaced");
    assert.deepEqual([...getArmedTrackIds()], ["b"]);
    unsubscribe();
    clearArmedTracks();
    assert.equal(notified, 3);
  });

  it("disarms tracks that left the session", () => {
    clearArmedTracks();
    setTrackArmed("a", true);
    setTrackArmed("gone", true);
    pruneArmedTracks(["a", "b"]);
    assert.deepEqual([...getArmedTrackIds()], ["a"]);
    clearArmedTracks();
  });
});

describe("record button", () => {
  it("is disabled until a track is armed", () => {
    assert.equal(canPressRecord("idle", 0), false);
    assert.equal(canPressRecord("idle", 1), true);
    assert.equal(canPressRecord("idle", 3), true);
  });

  it("is disabled while devices open or takes save, enabled while recording", () => {
    assert.equal(canPressRecord("starting", 1), false);
    assert.equal(canPressRecord("saving", 1), false);
    assert.equal(canPressRecord("recording", 0), true);
  });

  it("starts playback when pressed while stopped", () => {
    assert.deepEqual(pressRecord("idle", 1, false), {
      action: "start",
      startPlayback: true,
    });
  });

  it("joins playback already running", () => {
    assert.deepEqual(pressRecord("idle", 1, true), {
      action: "start",
      startPlayback: false,
    });
  });

  it("stops only the recording when pressed while recording", () => {
    assert.deepEqual(pressRecord("recording", 1, true), { action: "stop" });
    assert.equal(playbackEndsRecording("recording", true), false);
  });

  it("does nothing with no armed tracks", () => {
    assert.deepEqual(pressRecord("idle", 0, false), { action: "none" });
  });

  it("ends the recording when playback stops", () => {
    assert.equal(playbackEndsRecording("recording", false), true);
    assert.equal(playbackEndsRecording("idle", false), false);
    assert.equal(playbackEndsRecording("saving", false), false);
  });
});
