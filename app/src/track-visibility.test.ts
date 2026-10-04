import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTrackHidden,
  setTrackHidden,
  trackHiddenHistoryLabel,
} from "./track-visibility.ts";

describe("setTrackHidden", () => {
  const tracks = [
    { id: "1", name: "Layer 1" },
    { id: "2", name: "Layer 2" },
  ];

  it("hides one track", () => {
    const next = setTrackHidden(tracks, "2", true);
    assert.deepEqual(next, [
      { id: "1", name: "Layer 1" },
      { id: "2", name: "Layer 2", hidden: true },
    ]);
    assert.equal(isTrackHidden(next[1]), true);
    assert.equal(isTrackHidden(next[0]), false);
  });

  it("drops the flag when showing a track again", () => {
    const shown = setTrackHidden(setTrackHidden(tracks, "2", true), "2", false);
    assert.deepEqual(shown, tracks);
    assert.equal("hidden" in shown[1], false);
  });

  it("returns the same tracks when nothing changes", () => {
    assert.equal(setTrackHidden(tracks, "2", false), tracks);
    assert.equal(setTrackHidden(tracks, "missing", true), tracks);
  });

  it("names the history entry", () => {
    assert.equal(trackHiddenHistoryLabel("Layer 2", true), "Hide Layer 2");
    assert.equal(trackHiddenHistoryLabel("Layer 2", false), "Show Layer 2");
  });
});
