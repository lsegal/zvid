// Tracks media arriving from elsewhere so clips, source spans and the main
// Audio row can show a skeleton with progress: from a peer in a shared
// session, or downloaded from a URL (a bundled sample's assets). Queued
// media is waiting for a free transfer slot; receiving media has an open
// request, and its total stays 0 until the source reports a size.

import type { MediaAvailability } from "./media.ts";

export type RemoteMediaSource = "peer" | "url";

export type RemoteMediaPhase = "queued" | "receiving";

export type RemoteMediaProgress = {
  source: RemoteMediaSource;
  phase: RemoteMediaPhase;
  received: number;
  total: number;
};

export type RemoteMediaProgressMap = ReadonlyMap<string, RemoteMediaProgress>;

export type MediaSyncView = {
  source: RemoteMediaSource;
  phase: RemoteMediaPhase;
  // 0-1 when the transfer size is known, otherwise null (indeterminate).
  fraction: number | null;
};

// Each helper returns the same map when nothing changed so React can skip
// the render.
export function withRemoteMediaProgress(
  map: RemoteMediaProgressMap,
  mediaId: string,
  progress: RemoteMediaProgress,
): RemoteMediaProgressMap {
  const current = map.get(mediaId);
  if (
    current &&
    current.source === progress.source &&
    current.phase === progress.phase &&
    current.received === progress.received &&
    current.total === progress.total
  ) {
    return map;
  }
  const next = new Map(map);
  next.set(mediaId, progress);
  return next;
}

export function withoutRemoteMediaProgress(
  map: RemoteMediaProgressMap,
  mediaId: string,
): RemoteMediaProgressMap {
  if (!map.has(mediaId)) {
    return map;
  }
  const next = new Map(map);
  next.delete(mediaId);
  return next;
}

// Replaces `source`'s queued entries with queuedIds, leaving receiving
// entries and other sources' entries alone.
export function withQueuedRemoteMedia(
  map: RemoteMediaProgressMap,
  source: RemoteMediaSource,
  queuedIds: Iterable<string>,
): RemoteMediaProgressMap {
  const queued = new Set(queuedIds);
  let next: Map<string, RemoteMediaProgress> | null = null;
  for (const [mediaId, progress] of map) {
    if (
      progress.source === source &&
      progress.phase === "queued" &&
      !queued.has(mediaId)
    ) {
      next ??= new Map(map);
      next.delete(mediaId);
    }
  }
  for (const mediaId of queued) {
    if (!map.has(mediaId)) {
      next ??= new Map(map);
      next.set(mediaId, { source, phase: "queued", received: 0, total: 0 });
    }
  }
  return next ?? map;
}

export function getRemoteMediaFraction(progress: RemoteMediaProgress) {
  if (progress.phase !== "receiving" || progress.total <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, progress.received / progress.total));
}

// Media that is ready never shows the skeleton, even if a stale entry lingers.
export function describeMediaSync(
  progress: RemoteMediaProgress | undefined,
  availability: MediaAvailability | undefined,
): MediaSyncView | null {
  if (!progress || availability === "ready") {
    return null;
  }
  return {
    source: progress.source,
    phase: progress.phase,
    fraction: getRemoteMediaFraction(progress),
  };
}

// Rounds down so 100% only shows once every byte arrived; the epsilon keeps
// float error (0.58 * 100 = 57.99…) from dropping a whole percent.
function formatPercent(fraction: number) {
  return `${Math.floor(fraction * 100 + 1e-9)}%`;
}

// "Syncing 42%" on clips and spans; "Syncing main audio 42%" with a subject.
// Media downloaded from a URL is "Loading" instead.
export function formatMediaSyncLabel(view: MediaSyncView, subject?: string) {
  if (view.phase === "queued") {
    return subject ? `Waiting for ${subject}…` : "Waiting…";
  }
  const verb = view.source === "url" ? "Loading" : "Syncing";
  const prefix = subject ? `${verb} ${subject}` : verb;
  return view.fraction === null
    ? `${prefix}…`
    : `${prefix} ${formatPercent(view.fraction)}`;
}

export function getMediaSyncClassName(
  view: MediaSyncView,
  prefersReducedMotion: boolean,
) {
  return [
    "is-syncing",
    `is-syncing--${view.phase}`,
    prefersReducedMotion ? "" : "is-syncing--animated",
  ]
    .filter(Boolean)
    .join(" ");
}

// Summarizes every peer transfer for the status bar, or null until a peer
// has started sending. The percent covers transfers whose size is known.
export function formatPeerMediaSyncStatus(map: RemoteMediaProgressMap) {
  let started = false;
  let count = 0;
  let received = 0;
  let total = 0;
  for (const progress of map.values()) {
    if (progress.source !== "peer") {
      continue;
    }
    count += 1;
    if (progress.phase !== "receiving") {
      continue;
    }
    started ||= progress.received > 0 || progress.total > 0;
    if (progress.total > 0) {
      received += Math.min(progress.received, progress.total);
      total += progress.total;
    }
  }
  if (!started) {
    return null;
  }
  const files = `${count} ${count === 1 ? "file" : "files"}`;
  return total > 0
    ? `Syncing ${files} from peer… ${formatPercent(received / total)}`
    : `Syncing ${files} from peer…`;
}
