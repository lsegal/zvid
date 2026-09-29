// Tracks media being transferred from a peer in a shared session so clips,
// source spans and the main Audio row can show a skeleton with progress.
// Queued media is waiting for a free transfer slot; receiving media has an
// open request, and its total stays 0 until the peer reports a size.

import type { MediaAvailability } from "./media.ts";

export type PeerMediaPhase = "queued" | "receiving";

export type PeerMediaProgress = {
  phase: PeerMediaPhase;
  received: number;
  total: number;
};

export type PeerMediaProgressMap = ReadonlyMap<string, PeerMediaProgress>;

export type MediaSyncView = {
  phase: PeerMediaPhase;
  // 0-1 when the transfer size is known, otherwise null (indeterminate).
  fraction: number | null;
};

// Each helper returns the same map when nothing changed so React can skip
// the render.
export function withPeerMediaProgress(
  map: PeerMediaProgressMap,
  mediaId: string,
  progress: PeerMediaProgress,
): PeerMediaProgressMap {
  const current = map.get(mediaId);
  if (
    current &&
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

export function withoutPeerMediaProgress(
  map: PeerMediaProgressMap,
  mediaId: string,
): PeerMediaProgressMap {
  if (!map.has(mediaId)) {
    return map;
  }
  const next = new Map(map);
  next.delete(mediaId);
  return next;
}

// Replaces the queued entries with queuedIds, leaving receiving entries alone.
export function withQueuedPeerMedia(
  map: PeerMediaProgressMap,
  queuedIds: Iterable<string>,
): PeerMediaProgressMap {
  const queued = new Set(queuedIds);
  let next: Map<string, PeerMediaProgress> | null = null;
  for (const [mediaId, progress] of map) {
    if (progress.phase === "queued" && !queued.has(mediaId)) {
      next ??= new Map(map);
      next.delete(mediaId);
    }
  }
  for (const mediaId of queued) {
    if (!map.has(mediaId)) {
      next ??= new Map(map);
      next.set(mediaId, { phase: "queued", received: 0, total: 0 });
    }
  }
  return next ?? map;
}

export function getPeerMediaFraction(progress: PeerMediaProgress) {
  if (progress.phase !== "receiving" || progress.total <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, progress.received / progress.total));
}

// Media that is ready never shows the skeleton, even if a stale entry lingers.
export function describeMediaSync(
  progress: PeerMediaProgress | undefined,
  availability: MediaAvailability | undefined,
): MediaSyncView | null {
  if (!progress || availability === "ready") {
    return null;
  }
  return { phase: progress.phase, fraction: getPeerMediaFraction(progress) };
}

function formatPercent(fraction: number) {
  return `${Math.floor(fraction * 100)}%`;
}

// "Syncing 42%" on clips and spans; "Syncing main audio 42%" with a subject.
export function formatMediaSyncLabel(view: MediaSyncView, subject?: string) {
  if (view.phase === "queued") {
    return "Waiting…";
  }
  const prefix = subject ? `Syncing ${subject}` : "Syncing";
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

// Summarises every transfer for the status bar, or null until a peer has
// started sending. The percent covers transfers whose size is known.
export function formatPeerMediaSyncStatus(map: PeerMediaProgressMap) {
  let started = false;
  let received = 0;
  let total = 0;
  for (const progress of map.values()) {
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
  const count = map.size;
  const files = `${count} ${count === 1 ? "file" : "files"}`;
  return total > 0
    ? `Syncing ${files} from peer… ${formatPercent(received / total)}`
    : `Syncing ${files} from peer…`;
}
