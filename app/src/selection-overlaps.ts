import type { ProjectSession } from "./session.ts";

// A layer shows one clip at a time, so a session never holds two selections
// that overlap on the same main track. Clips placed later win an overlap, the
// same rule the editor applies when a clip is moved onto another.

export type ProjectSelection = NonNullable<
  ProjectSession["selections"]
>[number];

export interface SelectionOverlapResult {
  selections: ProjectSelection[];
  /** Selections that were shortened, as they were before trimming. */
  trimmed: ProjectSelection[];
  /** Selections that were covered entirely and removed. */
  dropped: ProjectSelection[];
}

/**
 * Trims or removes selections so none overlap on the same main track. Each
 * selection wins its overlaps with the selections before it: an earlier one
 * keeps its longer uncovered side, and is removed when it has none.
 */
export function resolveSelectionOverlaps(
  selections: readonly ProjectSelection[],
): SelectionOverlapResult {
  let resolved: ProjectSelection[] = [];
  for (const active of selections) {
    resolved = resolved.flatMap((selection) => trimAround(selection, active));
    resolved.push(active);
  }

  const byId = new Map(resolved.map((selection) => [selection.id, selection]));
  const trimmed: ProjectSelection[] = [];
  const dropped: ProjectSelection[] = [];
  for (const selection of selections) {
    const result = byId.get(selection.id);
    if (!result) dropped.push(selection);
    else if (result !== selection) trimmed.push(selection);
  }
  return { selections: resolved, trimmed, dropped };
}

function trimAround(
  selection: ProjectSelection,
  active: ProjectSelection,
): ProjectSelection[] {
  if (selection.mainTrackId !== active.mainTrackId) return [selection];

  const overlapStart = Math.max(selection.frameStart, active.frameStart);
  const overlapEnd = Math.min(selection.frameEnd, active.frameEnd);
  if (overlapEnd <= overlapStart) return [selection];

  const left = Math.max(0, active.frameStart - selection.frameStart);
  const right = Math.max(0, selection.frameEnd - active.frameEnd);
  if (left <= 0 && right <= 0) return [];
  return left >= right
    ? [{ ...selection, frameEnd: active.frameStart }]
    : [{ ...selection, frameStart: active.frameEnd }];
}

/** Resolves a loaded session's overlapping selections, if it has any. */
export function resolveSessionOverlaps(session: ProjectSession) {
  const { selections, trimmed, dropped } = resolveSelectionOverlaps(
    session.selections ?? [],
  );
  return {
    session:
      trimmed.length || dropped.length ? { ...session, selections } : session,
    trimmed,
    dropped,
  };
}

/** The load status note for selections `resolveSessionOverlaps` changed. */
export function formatOverlapNote({
  trimmed,
  dropped,
}: Pick<SelectionOverlapResult, "trimmed" | "dropped">) {
  const changes = [
    ...(trimmed.length ? [`trimmed ${countClips(trimmed.length)}`] : []),
    ...(dropped.length ? [`removed ${countClips(dropped.length)}`] : []),
  ];
  return changes.length
    ? `Overlapping clips on a layer were resolved: ${changes.join(" and ")}.`
    : "";
}

function countClips(count: number) {
  return `${count} ${count === 1 ? "clip" : "clips"}`;
}
