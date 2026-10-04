import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArrangementClip, MediaItem } from "./composition-active-clips.ts";
import { mediaWindowAt } from "./media-window.ts";

// At 60 BPM a quarter note lasts a second, so clip times read as seconds.
const BPM = 60;

function media(id: string, kind: MediaItem["kind"] = "video"): MediaItem {
  return {
    id,
    name: id,
    kind,
    durationSeconds: 60,
    hasAudio: true,
    hasVideo: kind === "video",
    previewUrl: `/${id}`,
  };
}

function clip(
  id: string,
  startSeconds: number,
  durationSeconds: number,
  extra: Partial<ArrangementClip> = {},
): ArrangementClip {
  return {
    id,
    sourceTrackId: "",
    laneId: "1",
    label: id,
    mediaPath: "",
    mediaId: id,
    startQ: startSeconds,
    durationSeconds,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: durationSeconds,
    tint: "#000",
    accent: "#fff",
    ...extra,
  };
}

function windowAt(
  clips: ArrangementClip[],
  items: MediaItem[],
  seconds: number,
) {
  const mediaById = new Map(items.map((item) => [item.id, item]));
  return Object.fromEntries(mediaWindowAt(clips, mediaById, seconds, BPM));
}

describe("mediaWindowAt", () => {
  const items = [media("a"), media("b"), media("song", "audio"), media("idle")];
  const clips = [clip("a", 0, 4), clip("b", 20, 4), clip("song", 0, 30)];

  it("leaves out media that isn't on the timeline and audio-only media", () => {
    assert.deepEqual(windowAt(clips, items, 1), { a: "auto" });
  });

  it("loads only the metadata of a clip coming up, then buffers it just before it starts", () => {
    assert.deepEqual(windowAt(clips, items, 14), {});
    assert.deepEqual(windowAt(clips, items, 16), { b: "metadata" });
    assert.deepEqual(windowAt(clips, items, 19), { b: "auto" });
  });

  it("releases media a while after its clip ends", () => {
    assert.deepEqual(windowAt(clips, items, 5), { a: "metadata" });
    assert.deepEqual(windowAt(clips, items, 7.5), {});
  });

  it("buffers media one of whose clips plays even when another is only near", () => {
    const twice = [clip("a", 0, 4), clip("a2", 6, 4, { mediaId: "a" })];
    assert.deepEqual(windowAt(twice, items, 3), { a: "auto" });
    assert.deepEqual(windowAt(twice.toReversed(), items, 3), { a: "auto" });
  });

  it("makes no element for fill, text or FX clips", () => {
    const generated = (["fill", "text", "fx"] as const).map((kind) =>
      clip(kind, 0, 4, { kind, mediaId: undefined }),
    );
    assert.deepEqual(windowAt(generated, items, 1), {});
  });
});
