import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CollaborationConnectionState } from "../collaboration.ts";
import type { MediaItem } from "../media.ts";
import {
  describeSessionMediaStatus,
  isInSharedMediaSession,
  listSessionMediaSync,
  listSessionOfflineMedia,
} from "./media-status.ts";
import type { ArrangementClip, SourceSpan } from "./types.ts";

const media = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: "a",
  name: "take.mp4",
  kind: "video",
  durationSeconds: 5,
  hasAudio: true,
  hasVideo: true,
  color: "#000",
  accent: "#fff",
  previewUrl: "",
  availability: "ready",
  ...extra,
});

const clip = (extra: Partial<ArrangementClip> = {}): ArrangementClip => ({
  id: "clip",
  sourceSpanId: "span",
  sourceTrackId: "track",
  laneId: "1",
  label: "Clip",
  mediaPath: "clip.mp4",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 0,
  sourceOffsetSeconds: 0,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 10,
  tint: "#000",
  accent: "#fff",
  ...extra,
});

const span = (extra: Partial<SourceSpan> = {}): SourceSpan => ({
  id: "span",
  sourceTrackId: "track",
  label: "Span",
  mediaPath: "span.mp4",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 0,
  tint: "#000",
  accent: "#fff",
  ...extra,
});

const collaboration = ({
  mediaPeerCount = 0,
  peersConnected = 0,
  sameBrowserPeers = 0,
} = {}) =>
  ({
    connected: false,
    peerCount: 0,
    mediaPeerCount,
    collaborators: [],
    diagnostics: { peersConnected, sameBrowserPeers },
  }) as unknown as CollaborationConnectionState;

describe("listSessionOfflineMedia", () => {
  it("counts media used only on source tracks", () => {
    const offline = listSessionOfflineMedia(
      [
        media({ id: "a", availability: "offline" }),
        media({ id: "b", availability: "offline" }),
        media({ id: "c" }),
      ],
      [clip({ mediaId: "a" })],
      [span({ mediaId: "b" }), span({ id: "span-2", mediaId: "b" })],
    );
    assert.deepEqual(
      offline.map((entry) => [entry.item.id, entry.clipCount]),
      [
        ["a", 1],
        ["b", 2],
      ],
    );
  });
});

describe("isInSharedMediaSession", () => {
  it("is false while not collaborating", () => {
    assert.equal(
      isInSharedMediaSession("idle", collaboration({ mediaPeerCount: 1 })),
      false,
    );
  });

  it("needs a connected peer", () => {
    assert.equal(isInSharedMediaSession("connected", collaboration()), false);
    assert.equal(
      isInSharedMediaSession("connected", collaboration({ mediaPeerCount: 1 })),
      true,
    );
    assert.equal(
      isInSharedMediaSession("sharing", collaboration({ peersConnected: 1 })),
      true,
    );
    assert.equal(
      isInSharedMediaSession(
        "connected",
        collaboration({ sameBrowserPeers: 1 }),
      ),
      true,
    );
  });
});

describe("listSessionMediaSync", () => {
  it("leaves out clips without a media file", () => {
    const entries = listSessionMediaSync({
      mediaItems: [media({ id: "a", availability: "offline" })],
      timelineClips: [
        clip({ id: "placeholder", mediaPath: "" }),
        clip({ id: "real", mediaId: "a" }),
      ],
      sourceSpans: [],
      mainAudioId: undefined,
      progress: new Map(),
      misses: new Set(),
      inSharedSession: false,
    });
    assert.deepEqual(
      entries.map((entry) => [entry.id, entry.role, entry.state]),
      [["a", "arrangement", "offline"]],
    );
  });
});

describe("describeSessionMediaStatus", () => {
  it("describes the session's media", () => {
    assert.equal(describeSessionMediaStatus([]), "No media");
    assert.equal(describeSessionMediaStatus([media()]), "Media linked");
    assert.equal(
      describeSessionMediaStatus([
        media({ id: "a", availability: "offline" }),
        media({ id: "b", availability: "hydrating" }),
      ]),
      "2 media files not ready",
    );
  });
});
