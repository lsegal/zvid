import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaAvailability, MediaItem } from "./media.ts";
import {
  listMediaSync,
  mediaSyncLabel,
  mediaSyncState,
  summarizeMediaSync,
} from "./media-sync.ts";
import type { PeerMediaProgress } from "./peer-media-sync.ts";

function media(id: string, availability: MediaAvailability): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    kind: "video",
    durationSeconds: 1,
    hasAudio: true,
    hasVideo: true,
    color: "#000",
    accent: "#fff",
    previewUrl: "",
    availability,
  } as MediaItem;
}

const none = new Set<string>();
const noProgress = new Map<string, PeerMediaProgress>();

describe("mediaSyncState", () => {
  it("reports ready media as ready in and out of a share", () => {
    assert.equal(
      mediaSyncState(media("a", "ready"), undefined, none, true),
      "ready",
    );
    assert.equal(
      mediaSyncState(media("a", "ready"), undefined, none, false),
      "ready",
    );
  });

  it("reports media not on disk outside a share as offline", () => {
    assert.equal(
      mediaSyncState(media("a", "offline"), undefined, none, false),
      "offline",
    );
    assert.equal(
      mediaSyncState(media("a", "offline"), undefined, new Set(["a"]), false),
      "offline",
    );
  });

  it("reports media waiting on a peer as queued", () => {
    assert.equal(
      mediaSyncState(media("a", "offline"), undefined, none, true),
      "queued",
    );
  });

  it("reports an active transfer as receiving", () => {
    assert.equal(
      mediaSyncState(media("a", "hydrating"), undefined, none, true),
      "receiving",
    );
    assert.equal(
      mediaSyncState(
        media("a", "offline"),
        { received: 1, total: 4, phase: "receiving" },
        none,
        true,
      ),
      "receiving",
    );
  });

  it("reports a peer miss as unavailable", () => {
    assert.equal(
      mediaSyncState(media("a", "offline"), undefined, new Set(["a"]), true),
      "unavailable",
    );
  });

  it("treats clips whose media item hasn't synced yet as queued", () => {
    assert.equal(
      mediaSyncState(undefined, undefined, none, true, "m"),
      "queued",
    );
    assert.equal(
      mediaSyncState(undefined, undefined, none, false, "m"),
      "offline",
    );
  });
});

describe("listMediaSync", () => {
  it("orders receiving, queued, unavailable, then ready, with roles", () => {
    const entries = listMediaSync({
      mediaItems: [
        media("ready", "ready"),
        media("miss", "offline"),
        media("wait", "offline"),
        media("main", "offline"),
        media("recv", "hydrating"),
      ],
      arrangementClips: [{ mediaId: "ready" }, { mediaId: "recv" }],
      sourceClips: [{ mediaId: "miss" }, { mediaId: "wait" }],
      mainAudioId: "main",
      progress: new Map([
        ["recv", { received: 5, total: 10, phase: "receiving" as const }],
      ]),
      misses: new Set(["miss"]),
      inSharedSession: true,
    });
    assert.deepEqual(
      entries.map((entry) => [entry.id, entry.state, entry.role]),
      [
        ["recv", "receiving", "arrangement"],
        ["wait", "queued", "source"],
        ["main", "queued", "main-audio"],
        ["miss", "unavailable", "source"],
        ["ready", "ready", "arrangement"],
      ],
    );
    assert.equal(entries[0].received, 5);
    assert.equal(entries[0].total, 10);
  });

  it("adds an entry for clip media that hasn't synced yet", () => {
    const entries = listMediaSync({
      mediaItems: [],
      arrangementClips: [{ mediaId: "later" }, { mediaId: "later" }],
      sourceClips: [],
      progress: noProgress,
      misses: none,
      inSharedSession: true,
    });
    assert.deepEqual(
      entries.map((entry) => [entry.id, entry.state]),
      [["later", "queued"]],
    );
  });
});

describe("summarizeMediaSync", () => {
  it("never counts syncing items as offline", () => {
    const summary = summarizeMediaSync(
      listMediaSync({
        mediaItems: [
          media("a", "ready"),
          media("b", "offline"),
          media("c", "hydrating"),
        ],
        arrangementClips: [
          { mediaId: "a" },
          { mediaId: "b" },
          { mediaId: "c" },
          { mediaId: "unsynced" },
        ],
        sourceClips: [],
        progress: new Map([
          ["c", { received: 1, total: 2, phase: "receiving" as const }],
        ]),
        misses: none,
        inSharedSession: true,
      }),
    );
    assert.deepEqual(summary, {
      total: 4,
      ready: 1,
      syncing: 3,
      offline: 0,
      percent: 37,
    });
    assert.equal(mediaSyncLabel(summary), "Syncing 1 of 4 media files… 37%");
  });

  it("counts peer misses and offline media, with no syncing label", () => {
    const shared = summarizeMediaSync(
      listMediaSync({
        mediaItems: [media("a", "ready"), media("b", "offline")],
        arrangementClips: [{ mediaId: "b" }],
        sourceClips: [],
        progress: noProgress,
        misses: new Set(["b"]),
        inSharedSession: true,
      }),
    );
    assert.equal(shared.offline, 1);
    assert.equal(shared.syncing, 0);
    assert.equal(mediaSyncLabel(shared), null);

    const local = summarizeMediaSync(
      listMediaSync({
        mediaItems: [media("a", "offline"), media("b", "offline")],
        arrangementClips: [{ mediaId: "a" }, { mediaId: "gone" }, {}],
        sourceClips: [],
        progress: noProgress,
        misses: none,
        inSharedSession: false,
      }),
    );
    assert.equal(local.offline, 4);
    assert.equal(local.syncing, 0);
  });

  it("uses the singular for one file", () => {
    assert.equal(
      mediaSyncLabel({
        total: 1,
        ready: 0,
        syncing: 1,
        offline: 0,
        percent: 0,
      }),
      "Syncing 0 of 1 media file… 0%",
    );
  });
});
