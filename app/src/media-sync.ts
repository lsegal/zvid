import type { MediaItem } from "./media.ts";
import type {
  PeerMediaProgress,
  PeerMediaProgressMap,
} from "./peer-media-sync.ts";
import { mediaDisplayName } from "./relink.ts";

/**
 * Where a session media item stands on this client:
 * - `queued`: a peer has or may have it; waiting for a transfer slot.
 * - `receiving`: a transfer from a peer is in progress.
 * - `ready`: received, cached, or linked on disk.
 * - `unavailable`: no connected peer could serve it.
 * - `offline`: not in a shared session and not on disk.
 */
export type MediaSyncState =
  | "queued"
  | "receiving"
  | "ready"
  | "unavailable"
  | "offline";

export type MediaSyncRole = "arrangement" | "source" | "main-audio" | "unused";

export type MediaSyncEntry = {
  id: string;
  // Missing when a clip references media whose item hasn't synced yet.
  item?: MediaItem;
  displayName: string;
  role: MediaSyncRole;
  state: MediaSyncState;
  received: number;
  total: number;
};

export type MediaSyncSummary = {
  total: number;
  ready: number;
  syncing: number;
  offline: number;
  // 0-100, over the items that are syncing or ready.
  percent: number;
};

type ClipRef = { mediaId?: string };

/**
 * Derives an item's sync state. A peer miss only counts while in a shared
 * session, and anything not on disk outside one is plain offline.
 */
export function mediaSyncState(
  item: Pick<MediaItem, "id" | "availability"> | undefined,
  progress: PeerMediaProgress | undefined,
  misses: ReadonlySet<string>,
  inSharedSession: boolean,
  id = item?.id,
): MediaSyncState {
  if (item?.availability === "ready") {
    return "ready";
  }
  if (!inSharedSession) {
    return "offline";
  }
  if (progress?.phase === "receiving" || item?.availability === "hydrating") {
    return "receiving";
  }
  if (id !== undefined && misses.has(id)) {
    return "unavailable";
  }
  return "queued";
}

const STATE_ORDER: Record<MediaSyncState, number> = {
  receiving: 0,
  queued: 1,
  unavailable: 2,
  offline: 2,
  ready: 3,
};

/**
 * Lists every session media item (arrangement, source tracks and main
 * audio) plus clips whose media item hasn't synced yet, ordered receiving,
 * queued, unavailable/offline, then ready.
 */
export function listMediaSync({
  mediaItems,
  arrangementClips,
  sourceClips,
  mainAudioId,
  progress,
  misses,
  inSharedSession,
}: {
  mediaItems: MediaItem[];
  // Placeholder clips, which never had media, should be left out.
  arrangementClips: ClipRef[];
  sourceClips: ClipRef[];
  mainAudioId?: string;
  progress: PeerMediaProgressMap;
  misses: ReadonlySet<string>;
  inSharedSession: boolean;
}): MediaSyncEntry[] {
  const arrangementIds = new Set(
    arrangementClips.flatMap((clip) => (clip.mediaId ? [clip.mediaId] : [])),
  );
  const sourceIds = new Set(
    sourceClips.flatMap((clip) => (clip.mediaId ? [clip.mediaId] : [])),
  );
  const roleOf = (id: string): MediaSyncRole =>
    id === mainAudioId
      ? "main-audio"
      : arrangementIds.has(id)
        ? "arrangement"
        : sourceIds.has(id)
          ? "source"
          : "unused";

  const entries: MediaSyncEntry[] = mediaItems.map((item) => {
    const itemProgress = progress.get(item.id);
    return {
      id: item.id,
      item,
      displayName: mediaDisplayName(item),
      role: roleOf(item.id),
      state: mediaSyncState(item, itemProgress, misses, inSharedSession),
      received: itemProgress?.received ?? 0,
      total: itemProgress?.total ?? 0,
    };
  });

  const known = new Set(mediaItems.map((item) => item.id));
  let missingIndex = 0;
  for (const clip of [...arrangementClips, ...sourceClips]) {
    const id = clip.mediaId ?? `clip:${missingIndex++}`;
    if (known.has(id)) {
      continue;
    }
    known.add(id);
    entries.push({
      id,
      displayName: clip.mediaId ? "Media not synced yet" : "Missing media",
      role: roleOf(id),
      state: mediaSyncState(
        undefined,
        undefined,
        misses,
        inSharedSession && Boolean(clip.mediaId),
        clip.mediaId,
      ),
      received: 0,
      total: 0,
    });
  }

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        STATE_ORDER[left.entry.state] - STATE_ORDER[right.entry.state] ||
        left.index - right.index,
    )
    .map(({ entry }) => entry);
}

/** 0-1 progress for one entry; queued and unknown totals count as 0. */
export function mediaSyncFraction(entry: MediaSyncEntry) {
  if (entry.state === "ready") {
    return 1;
  }
  if (entry.state !== "receiving" || entry.total <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, entry.received / entry.total));
}

/**
 * Counts for the header label. Syncing items never count as offline, so
 * a joiner waiting on the host never sees a false offline count.
 */
export function summarizeMediaSync(
  entries: MediaSyncEntry[],
): MediaSyncSummary {
  let ready = 0;
  let syncing = 0;
  let offline = 0;
  let progress = 0;
  for (const entry of entries) {
    if (entry.state === "ready") {
      ready += 1;
    } else if (entry.state === "queued" || entry.state === "receiving") {
      syncing += 1;
    } else {
      offline += 1;
    }
    progress += mediaSyncFraction(entry);
  }
  const counted = ready + syncing;
  return {
    total: entries.length,
    ready,
    syncing,
    offline,
    percent: counted ? Math.floor((progress / counted) * 100) : 0,
  };
}

/** "Syncing 3 of 6 media files… 58%", or null when nothing is syncing. */
export function mediaSyncLabel(summary: MediaSyncSummary) {
  if (!summary.syncing) {
    return null;
  }
  const counted = summary.ready + summary.syncing;
  return `Syncing ${summary.ready} of ${counted} media ${counted === 1 ? "file" : "files"}… ${summary.percent}%`;
}

export function formatMegabytes(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}
