import type { MediaItem } from "./media";

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

function pathSegments(rawPath: string) {
  return rawPath.toLowerCase().split(/[/\\]/).filter(Boolean);
}

function basename(rawPath: string) {
  return pathSegments(rawPath).pop() ?? rawPath.toLowerCase();
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
