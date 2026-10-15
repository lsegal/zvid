// Selecting several clips at once: layer clips, source clips, or both. The
// last item selected is the primary one, which the existing single
// selection (the selected clip, or the selected source clip) holds; the
// rest are the extra items kept alongside it. Copy, Cut, Delete and
// Duplicate act on the whole set as one undo step, and the clipboard keeps
// every item's offset from the earliest one and its layer or source track.
import {
  clipEffectTrackId,
  copyClipEffects,
  sourceClipEffectTrackId,
} from "../fx-stack.ts";
import { pasteClipboard } from "../range-edit.ts";
import {
  deleteSourceSpan,
  pasteIntoSourceTrack,
} from "../source-clip-edits.ts";
import type { ClipClipboard } from "./clip-ops.ts";
import { patchProjectState } from "./session-project.ts";
import { getClipEndQ } from "./timeline-math.ts";
import type { ArrangementClip, ProjectState, SourceSpan } from "./types.ts";

export type SelectionItem =
  | { kind: "clip"; id: string }
  | { kind: "span"; id: string; sourceTrackId: string };

export function isSameSelectionItem(a: SelectionItem, b: SelectionItem) {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * `items` with `item` taken out when it is there, else added last, which
 * makes it the primary item.
 */
export function toggleSelectionItem(
  items: readonly SelectionItem[],
  item: SelectionItem,
): SelectionItem[] {
  return items.some((candidate) => isSameSelectionItem(candidate, item))
    ? items.filter((candidate) => !isSameSelectionItem(candidate, item))
    : [...items, item];
}

/** `items` without repeats, keeping each item's last position. */
export function dedupeSelectionItems(
  items: readonly SelectionItem[],
): SelectionItem[] {
  return items.filter(
    (item, index) =>
      !items
        .slice(index + 1)
        .some((candidate) => isSameSelectionItem(candidate, item)),
  );
}

/** The status bar's description of a selection of `count` clips. */
export function describeMultiSelection(count: number) {
  return `${count} clips selected`;
}

// The selected items as clips and source clips, in timeline order.
export type MultiSelectionContent = {
  clips: readonly ArrangementClip[];
  spans: readonly SourceSpan[];
};

/**
 * Clipboard content for every clip and source clip in `content`, each
 * placed relative to the earliest, with its stack.
 */
export function copyMultiSelection(
  { clips, spans }: MultiSelectionContent,
  bpm: number,
  effects: ClipClipboard["effects"] = [],
): ClipClipboard {
  const starts = [...clips, ...spans].map((item) => item.startQ);
  const ends = [...clips, ...spans].map((item) => getClipEndQ(item, bpm));
  const startQ = starts.length ? Math.min(...starts) : 0;
  const endQ = ends.length ? Math.max(...ends) : 0;
  const stackIds = new Set([
    ...clips.map((clip) => clipEffectTrackId(clip.id)),
    ...spans.map((span) => sourceClipEffectTrackId(span.id)),
  ]);
  return {
    fragments: clips
      .map((clip) => ({ clip: { ...clip }, offsetQ: clip.startQ - startQ }))
      .toSorted((a, b) => a.offsetQ - b.offsetQ),
    sourceFragments: spans
      .map((span) => ({ span: { ...span }, offsetQ: span.startQ - startQ }))
      .toSorted((a, b) => a.offsetQ - b.offsetQ),
    durationQ: Math.max(0, endQ - startQ),
    effects: effects.filter((effect) => stackIds.has(effect.trackId)),
  };
}

/** Whether `clipboard` holds a copied multi-selection. */
export function isMultiClipboard(
  clipboard: ClipClipboard | null,
): clipboard is ClipClipboard & {
  sourceFragments: NonNullable<ClipClipboard["sourceFragments"]>;
} {
  return Boolean(clipboard?.sourceFragments);
}

/** The project without the clips `clipIds` and source clips `spanIds`. */
export function removeMultiSelection(
  current: ProjectState,
  clipIds: ReadonlySet<string>,
  spanIds: ReadonlySet<string>,
): ProjectState {
  let next = patchProjectState(current, {
    clips: current.clips.filter((clip) => !clipIds.has(clip.id)),
  });
  for (const spanId of spanIds) {
    const patch = deleteSourceSpan(next, spanId);
    next = patch ? patchProjectState(next, patch) : next;
  }
  return next;
}

// Where pasted content goes. `laneId` and `sourceTrackId` are where the
// topmost copied layer's and source track's items land, the rest keeping
// their distance below it; without one, each item goes back to its own.
export type MultiPasteTarget = {
  laneId?: string;
  sourceTrackId?: string;
};

// The row each of `rowIds` lands on when the topmost of them moves to
// `targetId`, the rest keeping their distance below it and stopping at the
// last row. Rows that no longer exist land on `targetId`, or on the first.
function mapRows(
  rowIds: readonly string[],
  allRowIds: readonly string[],
  targetId: string | undefined,
) {
  const indexes = rowIds
    .map((id) => allRowIds.indexOf(id))
    .filter((index) => index >= 0);
  const topIndex = indexes.length ? Math.min(...indexes) : 0;
  const targetIndex = targetId ? allRowIds.indexOf(targetId) : -1;
  const shift = targetIndex >= 0 ? targetIndex - topIndex : 0;
  const fallback = targetIndex >= 0 ? targetId : allRowIds[0];
  return new Map(
    rowIds.map((id) => {
      const index = allRowIds.indexOf(id);
      return [
        id,
        index < 0
          ? fallback
          : allRowIds[Math.min(allRowIds.length - 1, index + shift)],
      ];
    }),
  );
}

/**
 * Pastes a copied multi-selection from `pasteQ`: layer clips onto layers
 * and source clips into source tracks, keeping their spacing in time and
 * between rows. Each pasted item overwrites what it lands on, and gets the
 * stack it was copied with. Returns the project and the pasted items.
 */
export function pasteMultiClipboard(
  current: ProjectState,
  clipboard: ClipClipboard,
  target: MultiPasteTarget,
  pasteQ: number,
  createId: (kind: SelectionItem["kind"]) => string,
): { project: ProjectState; pasted: SelectionItem[] } {
  const pasted: SelectionItem[] = [];
  let next = current;
  const sourceFragments = clipboard.sourceFragments ?? [];
  const trackIds = mapRows(
    sourceFragments.map(({ span }) => span.sourceTrackId),
    next.sourceTracks.map((track) => track.id),
    target.sourceTrackId,
  );
  for (const { span, offsetQ } of sourceFragments) {
    const trackId = trackIds.get(span.sourceTrackId);
    if (!trackId) {
      continue;
    }
    const id = createId("span");
    const patch = pasteIntoSourceTrack(
      next,
      { fragments: [], durationQ: 0, sourceSpan: span, effects: clipboard.effects },
      trackId,
      pasteQ + offsetQ,
      () => id,
    );
    if (patch) {
      next = patchProjectState(next, patch);
      pasted.push({ kind: "span", id, sourceTrackId: trackId });
    }
  }

  const laneIds = mapRows(
    clipboard.fragments.map(({ clip }) => clip.laneId),
    next.lanes.map((lane) => lane.id),
    target.laneId,
  );
  for (const laneId of new Set(laneIds.values())) {
    if (!laneId) {
      continue;
    }
    const fragments = clipboard.fragments.filter(
      ({ clip }) => laneIds.get(clip.laneId) === laneId,
    );
    const ids = fragments.map(() => createId("clip"));
    const queue = [...ids];
    const { clips, pasted: placed } = pasteClipboard(
      next.clips,
      { fragments, durationQ: clipboard.durationQ },
      laneId,
      pasteQ,
      next.bpm,
      () => queue.shift() ?? createId("clip"),
    );
    next = patchProjectState(next, {
      clips,
      effects: copyClipEffects(
        next.effects,
        placed.map((clip, index) => [fragments[index].clip.id, clip.id]),
        clipboard.effects,
      ),
    });
    pasted.push(...placed.map((clip) => ({ kind: "clip" as const, id: clip.id })));
  }
  return { project: next, pasted };
}
