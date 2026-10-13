import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getClipWaveformKind } from "./clip-waveform.ts";

const clip = { mediaId: "m1", mediaPath: "take.mp4" };
const videoWithAudio = {
  kind: "video",
  hasVideo: true,
  hasAudio: true,
} as const;
const videoOnly = { kind: "video", hasVideo: true, hasAudio: false } as const;
const audioOnly = { kind: "audio", hasVideo: false, hasAudio: true } as const;
const image = { kind: "image", hasVideo: false, hasAudio: false } as const;

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

  it("draws no waveform on an image, which shows its picture", () => {
    assert.equal(getClipWaveformKind(clip, image, "online"), "none");
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
