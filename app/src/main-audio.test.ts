import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withMainAudio } from "./main-audio.ts";
import type { MediaItem } from "./media.ts";

function audio(id: string, name = id): MediaItem {
  return {
    id,
    name,
    kind: "audio",
    durationSeconds: 30,
    hasAudio: true,
    hasVideo: false,
    color: "#000",
    accent: "#fff",
    previewUrl: "",
    availability: "ready",
  };
}

describe("withMainAudio", () => {
  it("adds the media item and sets it as the main audio", () => {
    const clip = audio("clip");
    const song = audio("song.wav:10:1");

    const result = withMainAudio({ mediaItems: [clip] }, song);

    assert.deepEqual(result.mediaItems, [clip, song]);
    assert.equal(result.mainAudioId, "song.wav:10:1");
  });

  it("replaces the main audio and keeps the previous media item", () => {
    const previous = audio("old.wav:10:1");
    const next = audio("new.wav:20:2");

    const result = withMainAudio(
      { mediaItems: [previous], mainAudioId: previous.id },
      next,
    );

    assert.deepEqual(result.mediaItems, [previous, next]);
    assert.equal(result.mainAudioId, next.id);
  });

  it("does not duplicate a media item chosen again", () => {
    const stale = audio("song.wav:10:1", "stale");
    const fresh = audio("song.wav:10:1", "fresh");

    const result = withMainAudio(
      { mediaItems: [stale], mainAudioId: stale.id },
      fresh,
    );

    assert.deepEqual(result.mediaItems, [fresh]);
    assert.equal(result.mainAudioId, "song.wav:10:1");
  });
});
