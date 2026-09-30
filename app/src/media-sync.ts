import type { MediaItem } from "./media.ts";
import { mediaDisplayName } from "./relink.ts";
import type {
  RemoteMediaProgress,
  RemoteMediaProgressMap,
  RemoteMediaSource,
} from "./remote-media-sync.ts";

/**
 * Where a session media item stands on this client:
 * - `queued`: a peer or URL has or may have it; waiting for a transfer slot.
 * - `receiving`: a transfer from a peer or a download is in progress.
 * - `ready`: received, cached, or linked on disk.
 * - `unavailable`: no connected peer could serve it, or its download failed.
 * - `offline`: not in a shared session, not downloadable and not on disk.
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
  // Where pending media comes from, while it is queued, receiving or failed.
  source?: RemoteMediaSource;
  received: number;
  total: number;
};

// Media no source could deliver, by the source that failed: a peer miss or
// a failed download. Both can be retried.
export type RemoteMediaMisses = ReadonlyMap<string, RemoteMediaSource>;

export type MediaSyncSummary = {
  total: number;
  ready: number;
  syncing: number;
  offline: number;
  // 0-100, over the items that are syncing or ready.
  percent: number;
  // Whether everything still syncing is downloading from a URL, so labels
  // say "Loading" rather than "Syncing".
  loading: boolean;
};

type ClipRef = { mediaId?: string };

/**
 * Derives an item's sync state. Downloads from a URL count in or out of a
 * shared session; a peer miss only counts while in one, and anything else
 * not on disk outside one is plain offline.
 */
export function mediaSyncState(
  item: Pick<MediaItem, "id" | "availability"> | undefined,
  progress: RemoteMediaProgress | undefined,
  misses: RemoteMediaMisses,
  inSharedSession: boolean,
  id = item?.id,
): MediaSyncState {
  if (item?.availability === "ready") {
    return "ready";
  }
  if (progress?.source === "url") {
    return progress.phase;
  }
  const miss = id === undefined ? undefined : misses.get(id);
  if (miss === "url") {
    return "unavailable";
  }
  if (!inSharedSession) {
    return "offline";
  }
  if (progress?.phase === "receiving" || item?.availability === "hydrating") {
    return "receiving";
  }
  if (miss) {
    return "unavailable";
  }
  return "queued";
}

// Where a pending item comes from, or undefined once ready or offline.
function mediaSyncSource(
  state: MediaSyncState,
  progress: RemoteMediaProgress | undefined,
  miss: RemoteMediaSource | undefined,
): RemoteMediaSource | undefined {
  if (state === "queued" || state === "receiving") {
    return progress?.source ?? "peer";
  }
  return state === "unavailable" ? (miss ?? "peer") : undefined;
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
  progress: RemoteMediaProgressMap;
  misses: RemoteMediaMisses;
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
    const state = mediaSyncState(item, itemProgress, misses, inSharedSession);
    return {
      id: item.id,
      item,
      displayName: mediaDisplayName(item),
      role: roleOf(item.id),
      state,
      source: mediaSyncSource(state, itemProgress, misses.get(item.id)),
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
    const state = mediaSyncState(
      undefined,
      undefined,
      misses,
      inSharedSession && Boolean(clip.mediaId),
      clip.mediaId,
    );
    entries.push({
      id,
      displayName: clip.mediaId ? "Media not synced yet" : "Missing media",
      role: roleOf(id),
      state,
      source: mediaSyncSource(state, undefined, misses.get(id)),
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
  let loading = true;
  for (const entry of entries) {
    if (entry.state === "ready") {
      ready += 1;
    } else if (entry.state === "queued" || entry.state === "receiving") {
      syncing += 1;
      loading &&= entry.source === "url";
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
    loading: syncing > 0 && loading,
  };
}

/**
 * "Syncing 3 of 6 media files… 58%" ("Loading" when every pending file is
 * downloading from a URL), or null when nothing is syncing.
 */
export function mediaSyncLabel(summary: MediaSyncSummary) {
  if (!summary.syncing) {
    return null;
  }
  const counted = summary.ready + summary.syncing;
  const verb = summary.loading ? "Loading" : "Syncing";
  return `${verb} ${summary.ready} of ${counted} media ${counted === 1 ? "file" : "files"}… ${summary.percent}%`;
}

export function formatMegabytes(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}
