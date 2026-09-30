import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  describeMediaSync,
  formatMediaSyncLabel,
  formatPeerMediaSyncStatus,
  getMediaSyncClassName,
  getRemoteMediaFraction,
  type RemoteMediaProgressMap,
  withoutRemoteMediaProgress,
  withQueuedRemoteMedia,
  withRemoteMediaProgress,
} from "./remote-media-sync.ts";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const clipCardTsx = readFileSync(
  new URL("./components/timeline/ClipCard.tsx", import.meta.url),
  "utf8",
);
const sourceSpanTsx = readFileSync(
  new URL("./components/timeline/SourceSpan.tsx", import.meta.url),
  "utf8",
);
const mainAudioRowTsx = readFileSync(
  new URL("./components/timeline/MainAudioRow.tsx", import.meta.url),
  "utf8",
);
const timelineRowsTsx = `${clipCardTsx}
${sourceSpanTsx}
${mainAudioRowTsx}`;
const usePeerMediaTs = readFileSync(
  new URL("./hooks/usePeerMedia.ts", import.meta.url),
  "utf8",
);
const useMainAudioTs = readFileSync(
  new URL("./hooks/useMainAudio.ts", import.meta.url),
  "utf8",
);

const empty: RemoteMediaProgressMap = new Map();

describe("peer media progress model", () => {
  it("records progress and keeps the map when nothing changed", () => {
    const progress = {
      source: "peer",
      phase: "receiving",
      received: 10,
      total: 100,
    } as const;
    const map = withRemoteMediaProgress(empty, "m1", progress);
    assert.notEqual(map, empty);
    assert.deepEqual(map.get("m1"), progress);
    assert.equal(withRemoteMediaProgress(map, "m1", { ...progress }), map);

    const updated = withRemoteMediaProgress(map, "m1", {
      ...progress,
      received: 42,
    });
    assert.equal(updated.get("m1")?.received, 42);
    assert.equal(map.get("m1")?.received, 10);
  });

  it("drops an entry once its transfer settles", () => {
    const map = withRemoteMediaProgress(empty, "m1", {
      source: "peer",
      phase: "receiving",
      received: 1,
      total: 2,
    });
    const cleared = withoutRemoteMediaProgress(map, "m1");
    assert.equal(cleared.has("m1"), false);
    assert.equal(withoutRemoteMediaProgress(cleared, "m1"), cleared);
  });

  it("replaces queued entries without touching receiving ones", () => {
    let map = withRemoteMediaProgress(empty, "m1", {
      source: "peer",
      phase: "receiving",
      received: 5,
      total: 10,
    });
    map = withQueuedRemoteMedia(map, "peer", ["m2", "m3"]);
    assert.deepEqual(Array.from(map.keys()).sort(), ["m1", "m2", "m3"]);
    assert.equal(map.get("m2")?.phase, "queued");
    assert.equal(withQueuedRemoteMedia(map, "peer", ["m3", "m2"]), map);

    // Queued media that started receiving keeps its receiving entry.
    map = withRemoteMediaProgress(map, "m2", {
      source: "peer",
      phase: "receiving",
      received: 0,
      total: 0,
    });
    map = withQueuedRemoteMedia(map, "peer", ["m3"]);
    assert.equal(map.get("m2")?.phase, "receiving");

    map = withQueuedRemoteMedia(map, "peer", []);
    assert.deepEqual(Array.from(map.keys()).sort(), ["m1", "m2"]);
  });

  it("reports a fraction only while receiving with a known size", () => {
    assert.equal(
      getRemoteMediaFraction({
        source: "peer",
        phase: "receiving",
        received: 25,
        total: 100,
      }),
      0.25,
    );
    assert.equal(
      getRemoteMediaFraction({
        source: "peer",
        phase: "receiving",
        received: 25,
        total: 0,
      }),
      null,
    );
    assert.equal(
      getRemoteMediaFraction({
        source: "peer",
        phase: "queued",
        received: 0,
        total: 100,
      }),
      null,
    );
    assert.equal(
      getRemoteMediaFraction({
        source: "peer",
        phase: "receiving",
        received: 120,
        total: 100,
      }),
      1,
    );
  });
});

describe("media sync view", () => {
  it("shows syncing media until it is ready", () => {
    const progress = {
      source: "peer",
      phase: "receiving",
      received: 42,
      total: 100,
    } as const;
    assert.deepEqual(describeMediaSync(progress, "hydrating"), {
      source: "peer",
      phase: "receiving",
      fraction: 0.42,
    });
    assert.equal(describeMediaSync(progress, "ready"), null);
    assert.equal(describeMediaSync(undefined, "hydrating"), null);
    assert.equal(describeMediaSync(undefined, "offline"), null);
    assert.deepEqual(
      describeMediaSync(
        { source: "peer", phase: "queued", received: 0, total: 0 },
        "offline",
      ),
      { source: "peer", phase: "queued", fraction: null },
    );
  });

  it("labels progress, unknown sizes and queued media", () => {
    assert.equal(
      formatMediaSyncLabel({
        source: "peer",
        phase: "receiving",
        fraction: 0.429,
      }),
      "Syncing 42%",
    );
    assert.equal(
      formatMediaSyncLabel(
        { source: "peer", phase: "receiving", fraction: 0.42 },
        "main audio",
      ),
      "Syncing main audio 42%",
    );
    assert.equal(
      formatMediaSyncLabel({
        source: "peer",
        phase: "receiving",
        fraction: null,
      }),
      "Syncing…",
    );
    assert.equal(
      formatMediaSyncLabel({ source: "peer", phase: "queued", fraction: null }),
      "Waiting…",
    );
    assert.equal(
      formatMediaSyncLabel(
        { source: "peer", phase: "queued", fraction: null },
        "main audio",
      ),
      "Waiting for main audio…",
    );
  });

  it("drops the animation class when reduced motion is preferred", () => {
    const view = { source: "peer", phase: "receiving", fraction: 0.5 } as const;
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
        withQueuedRemoteMedia(
          withRemoteMediaProgress(empty, "m1", {
            source: "peer",
            phase: "receiving",
            received: 0,
            total: 0,
          }),
          "peer",
          ["m2"],
        ),
      ),
      null,
    );
  });

  it("summarizes overall progress across files", () => {
    let map = withRemoteMediaProgress(empty, "m1", {
      source: "peer",
      phase: "receiving",
      received: 50,
      total: 100,
    });
    assert.equal(
      formatPeerMediaSyncStatus(map),
      "Syncing 1 file from peer… 50%",
    );

    map = withRemoteMediaProgress(map, "m2", {
      source: "peer",
      phase: "receiving",
      received: 66,
      total: 100,
    });
    map = withQueuedRemoteMedia(map, "peer", ["m3"]);
    assert.equal(
      formatPeerMediaSyncStatus(map),
      "Syncing 3 files from peer… 58%",
    );
  });

  it("omits the percent when no size is known", () => {
    const map = withRemoteMediaProgress(empty, "m1", {
      source: "peer",
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
    assert.match(block, /withRemoteMediaProgress\(map, mediaId/);
    assert.match(block, /PEER_MEDIA_STATUS_INTERVAL_MS/);
    assert.match(
      block,
      /finally \{[\s\S]*withoutRemoteMediaProgress\(map, mediaId\)/,
    );
    assert.match(
      usePeerMediaTs,
      /withQueuedRemoteMedia\(map, "peer", queuedIds\)/,
    );
    assert.match(
      usePeerMediaTs,
      /formatPeerMediaSyncStatus\(remoteMediaProgress\)/,
    );
  });

  it("draws the skeleton on clips, source spans and the Audio row", () => {
    assert.match(clipCardTsx, /<MediaSyncSkeleton\s+variant="clip"/);
    assert.match(sourceSpanTsx, /<MediaSyncSkeleton\s+variant="span"/);
    assert.match(
      mainAudioRowTsx,
      /variant="waveform"\s+view=\{mainAudioSync\}/,
    );
    assert.match(
      useMainAudioTs,
      /mainAudioSync\s+\? formatMediaSyncLabel\(mainAudioSync, "main audio"\)/,
    );
    assert.equal(
      (
        timelineRowsTsx.match(
          /getMediaSyncClassName\([^,]+, prefersReducedMotion\)/g,
        ) ?? []
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

describe("url media progress", () => {
  it("keeps each source's queued entries apart", () => {
    let map = withQueuedRemoteMedia(empty, "url", ["s1", "s2"]);
    map = withQueuedRemoteMedia(map, "peer", ["p1"]);
    assert.deepEqual(Array.from(map.keys()).sort(), ["p1", "s1", "s2"]);
    assert.equal(map.get("s1")?.source, "url");
    assert.equal(map.get("p1")?.source, "peer");

    map = withQueuedRemoteMedia(map, "peer", []);
    assert.deepEqual(Array.from(map.keys()).sort(), ["s1", "s2"]);
    map = withQueuedRemoteMedia(map, "url", ["s2"]);
    assert.deepEqual(Array.from(map.keys()), ["s2"]);
  });

  it("labels downloads as loading", () => {
    const view = describeMediaSync(
      { source: "url", phase: "receiving", received: 42, total: 100 },
      "hydrating",
    );
    assert.deepEqual(view, {
      source: "url",
      phase: "receiving",
      fraction: 0.42,
    });
    assert.equal(view && formatMediaSyncLabel(view), "Loading 42%");
    assert.equal(
      view && formatMediaSyncLabel(view, "main audio"),
      "Loading main audio 42%",
    );
  });

  it("leaves the peer status alone", () => {
    const map = withRemoteMediaProgress(empty, "s1", {
      source: "url",
      phase: "receiving",
      received: 50,
      total: 100,
    });
    assert.equal(formatPeerMediaSyncStatus(map), null);
    assert.equal(
      formatPeerMediaSyncStatus(
        withRemoteMediaProgress(map, "p1", {
          source: "peer",
          phase: "receiving",
          received: 25,
          total: 100,
        }),
      ),
      "Syncing 1 file from peer… 25%",
    );
  });
});
