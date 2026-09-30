import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  describeMediaSync,
  formatMediaSyncLabel,
  formatPeerMediaSyncStatus,
  getMediaSyncClassName,
  getPeerMediaFraction,
  type PeerMediaProgressMap,
  withoutPeerMediaProgress,
  withPeerMediaProgress,
  withQueuedPeerMedia,
} from "./peer-media-sync.ts";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const usePeerMediaTs = readFileSync(
  new URL("./hooks/usePeerMedia.ts", import.meta.url),
  "utf8",
);
const useMainAudioTs = readFileSync(
  new URL("./hooks/useMainAudio.ts", import.meta.url),
  "utf8",
);

const empty: PeerMediaProgressMap = new Map();

describe("peer media progress model", () => {
  it("records progress and keeps the map when nothing changed", () => {
    const progress = { phase: "receiving", received: 10, total: 100 } as const;
    const map = withPeerMediaProgress(empty, "m1", progress);
    assert.notEqual(map, empty);
    assert.deepEqual(map.get("m1"), progress);
    assert.equal(withPeerMediaProgress(map, "m1", { ...progress }), map);

    const updated = withPeerMediaProgress(map, "m1", {
      ...progress,
      received: 42,
    });
    assert.equal(updated.get("m1")?.received, 42);
    assert.equal(map.get("m1")?.received, 10);
  });

  it("drops an entry once its transfer settles", () => {
    const map = withPeerMediaProgress(empty, "m1", {
      phase: "receiving",
      received: 1,
      total: 2,
    });
    const cleared = withoutPeerMediaProgress(map, "m1");
    assert.equal(cleared.has("m1"), false);
    assert.equal(withoutPeerMediaProgress(cleared, "m1"), cleared);
  });

  it("replaces queued entries without touching receiving ones", () => {
    let map = withPeerMediaProgress(empty, "m1", {
      phase: "receiving",
      received: 5,
      total: 10,
    });
    map = withQueuedPeerMedia(map, ["m2", "m3"]);
    assert.deepEqual(Array.from(map.keys()).sort(), ["m1", "m2", "m3"]);
    assert.equal(map.get("m2")?.phase, "queued");
    assert.equal(withQueuedPeerMedia(map, ["m3", "m2"]), map);

    // Queued media that started receiving keeps its receiving entry.
    map = withPeerMediaProgress(map, "m2", {
      phase: "receiving",
      received: 0,
      total: 0,
    });
    map = withQueuedPeerMedia(map, ["m3"]);
    assert.equal(map.get("m2")?.phase, "receiving");

    map = withQueuedPeerMedia(map, []);
    assert.deepEqual(Array.from(map.keys()).sort(), ["m1", "m2"]);
  });

  it("reports a fraction only while receiving with a known size", () => {
    assert.equal(
      getPeerMediaFraction({ phase: "receiving", received: 25, total: 100 }),
      0.25,
    );
    assert.equal(
      getPeerMediaFraction({ phase: "receiving", received: 25, total: 0 }),
      null,
    );
    assert.equal(
      getPeerMediaFraction({ phase: "queued", received: 0, total: 100 }),
      null,
    );
    assert.equal(
      getPeerMediaFraction({ phase: "receiving", received: 120, total: 100 }),
      1,
    );
  });
});

describe("media sync view", () => {
  it("shows syncing media until it is ready", () => {
    const progress = { phase: "receiving", received: 42, total: 100 } as const;
    assert.deepEqual(describeMediaSync(progress, "hydrating"), {
      phase: "receiving",
      fraction: 0.42,
    });
    assert.equal(describeMediaSync(progress, "ready"), null);
    assert.equal(describeMediaSync(undefined, "hydrating"), null);
    assert.equal(describeMediaSync(undefined, "offline"), null);
    assert.deepEqual(
      describeMediaSync({ phase: "queued", received: 0, total: 0 }, "offline"),
      { phase: "queued", fraction: null },
    );
  });

  it("labels progress, unknown sizes and queued media", () => {
    assert.equal(
      formatMediaSyncLabel({ phase: "receiving", fraction: 0.429 }),
      "Syncing 42%",
    );
    assert.equal(
      formatMediaSyncLabel(
        { phase: "receiving", fraction: 0.42 },
        "main audio",
      ),
      "Syncing main audio 42%",
    );
    assert.equal(
      formatMediaSyncLabel({ phase: "receiving", fraction: null }),
      "Syncing…",
    );
    assert.equal(
      formatMediaSyncLabel({ phase: "queued", fraction: null }),
      "Waiting…",
    );
    assert.equal(
      formatMediaSyncLabel({ phase: "queued", fraction: null }, "main audio"),
      "Waiting for main audio…",
    );
  });

  it("drops the animation class when reduced motion is preferred", () => {
    const view = { phase: "receiving", fraction: 0.5 } as const;
    assert.equal(
      getMediaSyncClassName(view, false),
      "is-syncing is-syncing--receiving is-syncing--animated",
    );
    assert.equal(
      getMediaSyncClassName(view, true),
      "is-syncing is-syncing--receiving",
    );
  });
});

describe("peer media sync status", () => {
  it("stays quiet until a peer starts sending", () => {
    assert.equal(formatPeerMediaSyncStatus(empty), null);
    assert.equal(
      formatPeerMediaSyncStatus(
        withQueuedPeerMedia(
          withPeerMediaProgress(empty, "m1", {
            phase: "receiving",
            received: 0,
            total: 0,
          }),
          ["m2"],
        ),
      ),
      null,
    );
  });

  it("summarises overall progress across files", () => {
    let map = withPeerMediaProgress(empty, "m1", {
      phase: "receiving",
      received: 50,
      total: 100,
    });
    assert.equal(
      formatPeerMediaSyncStatus(map),
      "Syncing 1 file from peer… 50%",
    );

    map = withPeerMediaProgress(map, "m2", {
      phase: "receiving",
      received: 66,
      total: 100,
    });
    map = withQueuedPeerMedia(map, ["m3"]);
    assert.equal(
      formatPeerMediaSyncStatus(map),
      "Syncing 3 files from peer… 58%",
    );
  });

  it("omits the percent when no size is known", () => {
    const map = withPeerMediaProgress(empty, "m1", {
      phase: "receiving",
      received: 4096,
      total: 0,
    });
    assert.equal(formatPeerMediaSyncStatus(map), "Syncing 1 file from peer…");
  });
});

describe("media sync rendering", () => {
  it("feeds per-media progress from requestMedia and clears it when settled", () => {
    const start = usePeerMediaTs.indexOf("controller.requestMedia(mediaId");
    assert.notEqual(start, -1, "missing peer media request");
    const block = usePeerMediaTs.slice(
      start,
      usePeerMediaTs.indexOf("})();", start),
    );
    assert.match(block, /onProgress\(received, total\)/);
    assert.match(block, /withPeerMediaProgress\(map, mediaId/);
    assert.match(block, /PEER_MEDIA_STATUS_INTERVAL_MS/);
    assert.match(
      block,
      /finally \{[\s\S]*withoutPeerMediaProgress\(map, mediaId\)/,
    );
    assert.match(usePeerMediaTs, /withQueuedPeerMedia\(map, queuedIds\)/);
    assert.match(
      usePeerMediaTs,
      /formatPeerMediaSyncStatus\(peerMediaProgress\)/,
    );
  });

  it("draws the skeleton on clips, source spans and the Audio row", () => {
    assert.match(appTsx, /<MediaSyncSkeleton\s+variant="clip"/);
    assert.match(appTsx, /<MediaSyncSkeleton\s+variant="span"/);
    assert.match(appTsx, /variant="waveform"\s+view=\{mainAudioSync\}/);
    assert.match(
      useMainAudioTs,
      /mainAudioSync\s+\? formatMediaSyncLabel\(mainAudioSync, "main audio"\)/,
    );
    assert.equal(
      (
        appTsx.match(/getMediaSyncClassName\([^,]+, prefersReducedMotion\)/g) ??
        []
      ).length,
      3,
    );
  });

  it("animates the shimmer only under the animated class", () => {
    assert.match(
      appCss,
      /\.is-syncing--animated \.media-sync__shimmer \{\s*animation: media-sync-shimmer/,
    );
    assert.match(appCss, /@keyframes media-sync-shimmer/);
    assert.match(
      appCss,
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.media-sync__shimmer,/,
    );
  });
});
