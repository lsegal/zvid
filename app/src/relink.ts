import type { MediaAvailability, MediaItem } from "./media";

export type RelinkCandidate<T> = {
  name: string;
  path?: string;
  id?: string;
  source: T;
};

export type RelinkMatch<T> = {
  item: MediaItem;
  candidate: RelinkCandidate<T>;
};

export type RelinkResult<T> = {
  matches: RelinkMatch<T>[];
  unmatched: RelinkCandidate<T>[];
  ambiguous: Array<{ candidate: RelinkCandidate<T>; items: MediaItem[] }>;
};

/** One outcome per selected file, in the order the files were picked. */
export type RelinkOutcome =
  | { status: "linked"; item: MediaItem; file: string; warning?: string }
  | { status: "failed"; item: MediaItem; file: string; reason: string }
  | { status: "ambiguous"; file: string; items: MediaItem[] }
  | { status: "unmatched"; file: string };

export type RelinkReport = {
  outcomes: RelinkOutcome[];
  remainingOffline: number;
};

export type OfflineMediaEntry = {
  item: MediaItem;
  displayName: string;
  sourcePath?: string;
  clipCount: number;
  state: Exclude<MediaAvailability, "ready">;
  lastError?: string;
};

function pathSegments(rawPath: string) {
  return rawPath.toLowerCase().split(/[/\\]/).filter(Boolean);
}

function basename(rawPath: string) {
  return pathSegments(rawPath).pop() ?? rawPath.toLowerCase();
}

function displayBasename(rawPath: string) {
  return rawPath.split(/[/\\]/).filter(Boolean).pop() ?? rawPath;
}

export function relinkCandidateFile<T>(candidate: RelinkCandidate<T>) {
  return candidate.path ?? candidate.name;
}

/**
 * Lists every media item that is not ready, with the number of arrangement
 * and source-track clips that reference it, so the header count, Locate
 * Media, and the Offline Media dialog all work from the same list.
 */
export function listOfflineMedia(
  mediaItems: MediaItem[],
  clips: Array<{ mediaId?: string }>,
): OfflineMediaEntry[] {
  const clipCounts = new Map<string, number>();
  for (const clip of clips) {
    if (clip.mediaId) {
      clipCounts.set(clip.mediaId, (clipCounts.get(clip.mediaId) ?? 0) + 1);
    }
  }

  return mediaItems
    .filter((item) => item.availability !== "ready")
    .map((item) => ({
      item,
      displayName:
        item.name ||
        (item.sourcePath ? displayBasename(item.sourcePath) : item.id),
      sourcePath: item.sourcePath,
      clipCount: clipCounts.get(item.id) ?? 0,
      state: item.availability === "hydrating" ? "hydrating" : "offline",
    }));
}

/**
 * Warns when a file picked for a specific item has a different name than the
 * media it replaces, since a forced link skips name matching.
 */
export function forcedRelinkWarning<T>(
  item: MediaItem,
  candidate: RelinkCandidate<T>,
) {
  const name = basename(candidate.name);
  return matchesName(item, name)
    ? undefined
    : `${displayBasename(candidate.name)} does not match the original file name ${item.name}.`;
}

function matchingSuffixLength(left: string, right: string) {
  const leftSegments = pathSegments(left);
  const rightSegments = pathSegments(right);
  let length = 0;
  while (
    length < leftSegments.length &&
    length < rightSegments.length &&
    leftSegments[leftSegments.length - 1 - length] ===
      rightSegments[rightSegments.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function matchesName(item: MediaItem, name: string) {
  return (
    item.name.toLowerCase() === name ||
    (item.sourcePath !== undefined && basename(item.sourcePath) === name)
  );
}

/**
 * Pairs picked files with offline media items: exact id first, then
 * case-insensitive file name, breaking name collisions by the longest
 * matching `sourcePath` suffix. Ties are reported instead of guessed.
 */
export function matchOfflineMedia<T>(
  offlineItems: MediaItem[],
  candidates: RelinkCandidate<T>[],
): RelinkResult<T> {
  const claimed = new Set<string>();
  const matches: RelinkMatch<T>[] = [];
  const unmatched: RelinkCandidate<T>[] = [];
  const ambiguous: RelinkResult<T>["ambiguous"] = [];
  const pending: RelinkCandidate<T>[] = [];

  for (const candidate of candidates) {
    const item = candidate.id
      ? offlineItems.find(
          (entry) => entry.id === candidate.id && !claimed.has(entry.id),
        )
      : undefined;
    if (item) {
      claimed.add(item.id);
      matches.push({ item, candidate });
    } else {
      pending.push(candidate);
    }
  }

  for (const candidate of pending) {
    const name = basename(candidate.name);
    const named = offlineItems.filter(
      (item) => !claimed.has(item.id) && matchesName(item, name),
    );
    if (!named.length) {
      unmatched.push(candidate);
      continue;
    }

    if (named.length === 1) {
      claimed.add(named[0].id);
      matches.push({ item: named[0], candidate });
      continue;
    }

    const candidatePath = candidate.path ?? candidate.name;
    const scored = named.map((item) => ({
      item,
      score: item.sourcePath
        ? matchingSuffixLength(item.sourcePath, candidatePath)
        : 0,
    }));
    const best = Math.max(...scored.map((entry) => entry.score));
    const winners = scored.filter((entry) => entry.score === best);
    if (winners.length === 1) {
      claimed.add(winners[0].item.id);
      matches.push({ item: winners[0].item, candidate });
      continue;
    }

    ambiguous.push({
      candidate,
      items: winners.map((entry) => entry.item),
    });
  }

  return { matches, unmatched, ambiguous };
}
