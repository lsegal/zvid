import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AudioMixInputs, resolveAudioClips } from "./audio-mix/resolve.ts";
import { audioMixPeaksKey } from "./audio-mix-clips.ts";
import type { MediaItem } from "./media.ts";

const MEDIA = new Map([
  ["tone", { hasAudio: true, durationSeconds: 8 }],
  ["drums", { hasAudio: true, durationSeconds: 8 }],
  ["video", { hasAudio: false, durationSeconds: 8 }],
]);

function mediaItem(id: string): MediaItem {
  return {
    id,
    availability: "ready",
    previewUrl: `blob:${id}`,
  } as MediaItem;
}

const MEDIA_ITEMS = new Map(
  [...MEDIA.keys()].map((id) => [id, mediaItem(id)] as const),
);

function gain(trackId: string) {
  return {
    id: `gain-${trackId}`,
    trackId,
    effectName: "Gain",
    parameters: [
      { key: "Gain", value: "0", numericValue: 0 },
      { key: "Mute", value: "0", numericValue: 0 },
    ],
  };
}

function span(
  id: string,
  mediaId: string,
  startQ = 0,
  durationSeconds = 2,
  sourceTrackId = "track-1",
) {
  return {
    id,
    sourceTrackId,
    mediaId,
    startQ,
    durationSeconds,
    trimStartSeconds: 0,
  };
}

// A layer clip showing its media's own source track (see `inputs`) from
// its start.
function layerClip(
  id: string,
  mediaId: string | undefined,
  startQ = 0,
  kind?: "fill" | "text" | "fx",
) {
  return {
    id,
    laneId: "lane-1",
    sourceSpanId: `of-${mediaId}`,
    sourceTrackId: `track-${mediaId}`,
    mediaPath: `${mediaId}.wav`,
    mediaId,
    startQ,
    durationSeconds: 2,
    trimStartSeconds: 0,
    sourceOffsetSeconds: -startQ / 2,
    sourceSpanOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 2,
    ...(kind ? { kind } : {}),
  };
}

// Layer clips show what their source tracks hold, so each media a layer
// clip names gets a source track holding it.
function inputs(overrides: Partial<AudioMixInputs> = {}): AudioMixInputs {
  const mediaIds = new Set(
    (overrides.clips ?? []).flatMap((clip) =>
      !clip.kind && clip.mediaId ? [clip.mediaId] : [],
    ),
  );
  return {
    clips: [],
    lanes: [{ id: "lane-1" }],
    sourceTracks: [{ id: "track-1" }],
    mediaById: MEDIA,
    effects: [gain("source-track:track-1"), gain("lane-1")],
    bpm: 120,
    ...overrides,
    sourceSpans: [
      ...(overrides.sourceSpans ?? [
        span("audio", "tone"),
        span("picture", "video", 8),
      ]),
      ...[...mediaIds].map((mediaId) =>
        span(`of-${mediaId}`, mediaId, 0, 16, `track-${mediaId}`),
      ),
    ],
  };
}

function key(overrides: Partial<AudioMixInputs> = {}, media = MEDIA_ITEMS) {
  return audioMixPeaksKey(resolveAudioClips(inputs(overrides)), media);
}

describe("audioMixPeaksKey", () => {
  const base = inputs();

  it("ignores edits to source clips without audio", () => {
    const before = key();
    // Moved, resized, inserted and deleted.
    assert.equal(
      key({ sourceSpans: [base.sourceSpans[0], span("picture", "video", 12)] }),
      before,
    );
    assert.equal(
      key({
        sourceSpans: [base.sourceSpans[0], span("picture", "video", 8, 5)],
      }),
      before,
    );
    assert.equal(
      key({ sourceSpans: [...base.sourceSpans, span("more", "video", 16)] }),
      before,
    );
    assert.equal(key({ sourceSpans: [base.sourceSpans[0]] }), before);
  });

  it("ignores edits to layer clips without audio", () => {
    const before = key({ clips: [layerClip("fill", undefined, 0, "fill")] });
    assert.equal(key(), before);
    assert.equal(
      key({ clips: [layerClip("fill", undefined, 4, "fill")] }),
      before,
    );
    assert.equal(key({ clips: [layerClip("over-video", "video", 4)] }), before);
    assert.equal(
      key({
        clips: [
          layerClip("fill", undefined, 0, "fill"),
          layerClip("over-video", "video", 8),
        ],
      }),
      before,
    );
  });

  it("ignores media changes outside the mix", () => {
    const media = new Map(MEDIA_ITEMS);
    media.set("video", { ...mediaItem("video"), previewUrl: "blob:other" });
    media.set("new", mediaItem("new"));
    assert.equal(key({}, media), key());
  });

  it("changes on edits to source clips with audio", () => {
    const before = key();
    assert.notEqual(
      key({ sourceSpans: [span("audio", "tone", 2), base.sourceSpans[1]] }),
      before,
    );
    assert.notEqual(
      key({ sourceSpans: [span("audio", "tone", 0, 3), base.sourceSpans[1]] }),
      before,
    );
    assert.notEqual(
      key({ sourceSpans: [...base.sourceSpans, span("more", "drums", 16)] }),
      before,
    );
    assert.notEqual(key({ sourceSpans: [base.sourceSpans[1]] }), before);
  });

  it("changes on edits to layer clips with audio", () => {
    const before = key({ clips: [layerClip("voice", "tone")] });
    assert.notEqual(key({ clips: [layerClip("voice", "tone", 2)] }), before);
    assert.notEqual(
      key({
        clips: [layerClip("voice", "tone"), layerClip("kit", "drums", 8)],
      }),
      before,
    );
    assert.notEqual(key(), before);
  });

  it("changes when a clip gains or loses audio", () => {
    // A source clip re-pointed from audio to video-only media and back.
    const withAudio = key();
    const withoutAudio = key({
      sourceSpans: [span("audio", "video"), base.sourceSpans[1]],
    });
    assert.notEqual(withoutAudio, withAudio);
    assert.notEqual(
      key({
        sourceSpans: [span("audio", "video"), span("picture", "tone", 8)],
      }),
      withoutAudio,
    );

    // A layer clip moved from audio media onto video-only media.
    const layered = key({ clips: [layerClip("voice", "tone")] });
    assert.notEqual(key({ clips: [layerClip("voice", "video")] }), layered);
  });

  it("changes when a mixed clip's media becomes playable", () => {
    const media = new Map(MEDIA_ITEMS);
    media.set("tone", {
      ...mediaItem("tone"),
      availability: "hydrating",
    } as MediaItem);
    assert.notEqual(key({}, media), key());
  });
});
