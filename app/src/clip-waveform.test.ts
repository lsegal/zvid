import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getClipWaveformKind } from "./clip-waveform.ts";

const clip = { mediaId: "m1", mediaPath: "take.mp4" };
const videoWithAudio = { hasVideo: true, hasAudio: true };
const videoOnly = { hasVideo: true, hasAudio: false };
const audioOnly = { hasVideo: false, hasAudio: true };

describe("getClipWaveformKind", () => {
  it("overlays the waveform on video with audio", () => {
    assert.equal(
      getClipWaveformKind(clip, videoWithAudio, "online"),
      "overlay",
    );
  });

  it("draws no waveform on video without audio", () => {
    assert.equal(getClipWaveformKind(clip, videoOnly, "online"), "none");
  });

  it("draws audio-only media's waveform in place of a filmstrip", () => {
    assert.equal(getClipWaveformKind(clip, audioOnly, "online"), "audio");
  });

  it("draws nothing for media that is not online", () => {
    for (const state of ["offline", "hydrating", "placeholder"] as const) {
      assert.equal(getClipWaveformKind(clip, videoWithAudio, state), "none");
      assert.equal(getClipWaveformKind(clip, audioOnly, state), "none");
    }
  });

  it("draws nothing without media", () => {
    assert.equal(getClipWaveformKind(clip, undefined, "online"), "none");
  });

  it("draws nothing for fill, text and FX clips", () => {
    for (const kind of ["fill", "text", "fx"]) {
      assert.equal(
        getClipWaveformKind({ kind }, videoWithAudio, "online"),
        "none",
      );
    }
  });
});
