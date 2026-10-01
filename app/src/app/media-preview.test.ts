import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMediaTime,
  type PreviewPlaybackState,
  reducePreviewPlayback,
} from "./media-preview.ts";

const timecode = {
  timelineMode: "timecode" as const,
  bpm: 120,
  fps: 30,
  signature: { numerator: 4, denominator: 4 },
};
const musical = { ...timecode, timelineMode: "musical" as const };

describe("formatMediaTime", () => {
  it("formats timecode as minutes, seconds and frames", () => {
    assert.equal(formatMediaTime(0, timecode), "00:00:00");
    assert.equal(formatMediaTime(1.5, timecode), "00:01:15");
    assert.equal(formatMediaTime(72.5, timecode), "01:12:15");
  });

  it("formats musical time from zero at the session tempo", () => {
    // 120 bpm: a beat is half a second and a 4/4 bar two seconds.
    assert.equal(formatMediaTime(0, musical), "0.0.0");
    assert.equal(formatMediaTime(0.5, musical), "0.1.0");
    assert.equal(formatMediaTime(3, musical), "1.2.0");
    assert.equal(formatMediaTime(3, { ...musical, bpm: 60 }), "0.3.0");
  });

  it("clamps negative time to zero", () => {
    assert.equal(formatMediaTime(-1, timecode), "00:00:00");
  });
});

const idle: PreviewPlaybackState = {
  tab: "timeline",
  timelinePlaying: false,
  mediaPlaying: false,
};

describe("reducePreviewPlayback", () => {
  it("pauses the timeline when the media starts, and the reverse", () => {
    const timeline = reducePreviewPlayback(idle, {
      type: "play",
      target: "timeline",
    });
    assert.deepEqual(timeline, { ...idle, timelinePlaying: true });

    const media = reducePreviewPlayback(timeline, {
      type: "play",
      target: "media",
    });
    assert.deepEqual(media, { ...idle, mediaPlaying: true });

    assert.deepEqual(
      reducePreviewPlayback(media, { type: "play", target: "timeline" }),
      { ...idle, timelinePlaying: true },
    );
  });

  it("pausing one leaves the other alone", () => {
    assert.deepEqual(
      reducePreviewPlayback(
        { ...idle, timelinePlaying: true },
        { type: "pause", target: "media" },
      ),
      { ...idle, timelinePlaying: true },
    );
  });

  it("toggles the active tab's playback", () => {
    const onTimeline = reducePreviewPlayback(idle, { type: "toggle-active" });
    assert.deepEqual(onTimeline, { ...idle, timelinePlaying: true });
    assert.deepEqual(
      reducePreviewPlayback(onTimeline, { type: "toggle-active" }),
      idle,
    );

    const onMedia = reducePreviewPlayback(
      { ...idle, tab: "media", timelinePlaying: true },
      { type: "toggle-active" },
    );
    assert.deepEqual(onMedia, {
      tab: "media",
      timelinePlaying: false,
      mediaPlaying: true,
    });
    assert.deepEqual(
      reducePreviewPlayback(onMedia, { type: "toggle-active" }),
      { ...idle, tab: "media" },
    );
  });

  it("pauses the tab being left when switching tabs", () => {
    assert.deepEqual(
      reducePreviewPlayback(
        { ...idle, timelinePlaying: true },
        { type: "select-tab", tab: "media" },
      ),
      { ...idle, tab: "media" },
    );
    assert.deepEqual(
      reducePreviewPlayback(
        { ...idle, tab: "media", mediaPlaying: true },
        { type: "select-tab", tab: "timeline" },
      ),
      idle,
    );
  });

  it("keeps playback when selecting the tab already showing", () => {
    const playing = { ...idle, timelinePlaying: true };
    assert.equal(
      reducePreviewPlayback(playing, { type: "select-tab", tab: "timeline" }),
      playing,
    );
  });
});
