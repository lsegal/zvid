// Pasting, duplicating, splitting and deleting source clips (source spans)
// from their right-click menu and the keyboard shortcuts. Each returns the
// project patch for one undo step. Pieces placed onto other spans in the same
// source track overwrite them as a moved span does. Arrangement clips keep
// their windows on their source tracks and show whatever those now hold
// (see source-track-content.ts).
import { type ClipClipboard, clipClipboardKind } from "./app/clip-ops.ts";
import { getClipEndQ } from "./app/timeline-math.ts";
import type { ProjectState, SourceSpan } from "./app/types.ts";
import { getSwatch } from "./app/util.ts";
import { canSplitAt } from "./clip-menu.ts";
import { copyEffectStacks, sourceClipEffectTrackId } from "./fx-stack.ts";
import {
  resolveSourceSpanOverlaps,
  retimeSourceSpan,
} from "./source-span-edit.ts";
import { syncClipsToSourceSpans } from "./source-track-content.ts";

export type SourceClipProject = Pick<
  ProjectState,
  "bpm" | "clips" | "effects" | "sourceSpans" | "sourceTracks"
>;

export type SourceClipPatch = Partial<
  Pick<ProjectState, "clips" | "effects" | "sourceSpans" | "sourceTracks">
>;

/**
 * Whether `clipboard` can be pasted into a source track: only content copied
 * from a source clip can. Layer clips paste only onto layers.
 */
export function canPasteIntoSourceTrack(
  clipboard: ClipClipboard | null,
): clipboard is ClipClipboard & { sourceSpan: SourceSpan } {
  return clipboard !== null && clipClipboardKind(clipboard) === "source";
}

// `spans` placed in order, each overwriting what it lands on in its track,
// with the arrangement clips synced and each `[from, to]` stack copied
// from `stackSource`.
function placeSourceSpans(
  current: SourceClipProject,
  sourceSpans: SourceSpan[],
  spans: readonly SourceSpan[],
  copies: Iterable<readonly [string, string]>,
  stackSource = current.effects,
): SourceClipPatch {
  let nextSpans = sourceSpans;
  for (const span of spans) {
    nextSpans = resolveSourceSpanOverlaps(
      [...nextSpans, span],
      span,
      current.bpm,
    );
  }
  return {
    sourceSpans: nextSpans,
    clips: syncClipsToSourceSpans(
      current.clips,
      current.sourceSpans,
      nextSpans,
      current.bpm,
    ),
    effects: copyEffectStacks(current.effects, copies, stackSource),
  };
}

/**
 * Pastes the source clip `clipboard` was copied from into source track
 * `trackId` at `pasteQ`, with the stack it was copied with. Undefined when
 * there is nothing to paste there: layer clips paste only onto layers.
 */
export function pasteIntoSourceTrack(
  current: SourceClipProject,
  clipboard: ClipClipboard,
  trackId: string,
  pasteQ: number,
  createId: () => string,
): SourceClipPatch | undefined {
  const track = current.sourceTracks.find((item) => item.id === trackId);
  if (!track || !canPasteIntoSourceTrack(clipboard)) {
    return undefined;
  }

  const swatch = getSwatch(track.colorIndex);
  const id = createId();
  const copies: Array<[string, string]> = [
    [
      sourceClipEffectTrackId(clipboard.sourceSpan.id),
      sourceClipEffectTrackId(id),
    ],
  ];
  const spans: SourceSpan[] = [
    {
      ...clipboard.sourceSpan,
      id,
      sourceTrackId: trackId,
      startQ: pasteQ,
      tint: swatch.color,
      accent: swatch.accent,
    },
  ];

  // The track lists the media it plays, as a drop onto it does.
  const newPaths = [...new Set(spans.map((span) => span.mediaPath))].filter(
    (path) => !track.recordingPaths.includes(path),
  );
  return {
    ...(newPaths.length
      ? {
          sourceTracks: current.sourceTracks.map((item) =>
            item.id === trackId
              ? {
                  ...item,
                  recordingPaths: [...item.recordingPaths, ...newPaths],
                }
              : item,
          ),
        }
      : {}),
    ...placeSourceSpans(
      current,
      current.sourceSpans,
      spans,
      copies,
      clipboard.effects ?? current.effects,
    ),
  };
}

/**
 * A copy of source clip `spanId`, with its stack, right after it in its
 * source track, overwriting what it lands on.
 */
export function duplicateSourceSpan(
  current: SourceClipProject,
  spanId: string,
  id: string,
): SourceClipPatch | undefined {
  const span = current.sourceSpans.find((item) => item.id === spanId);
  if (!span) {
    return undefined;
  }

  return placeSourceSpans(
    current,
    current.sourceSpans,
    [{ ...span, id, startQ: getClipEndQ(span, current.bpm) }],
    [[sourceClipEffectTrackId(spanId), sourceClipEffectTrackId(id)]],
  );
}

/**
 * Source clip `spanId` split at `splitQ` into itself and a new clip `id`
 * that plays on from where it stops, with a copy of its stack. Arrangement
 * clips keep showing the same content, now from the two pieces. Undefined
 * unless `splitQ` is inside the clip.
 */
export function splitSourceSpan(
  current: SourceClipProject,
  spanId: string,
  splitQ: number,
  id: string,
): SourceClipPatch | undefined {
  const { bpm } = current;
  const span = current.sourceSpans.find((item) => item.id === spanId);
  if (!span) {
    return undefined;
  }

  const endQ = getClipEndQ(span, bpm);
  if (!canSplitAt(span.startQ, endQ, splitQ)) {
    return undefined;
  }

  const left = retimeSourceSpan(span, span.startQ, splitQ - span.startQ, bpm);
  const right = retimeSourceSpan({ ...span, id }, splitQ, endQ - splitQ, bpm);
  const sourceSpans = current.sourceSpans.flatMap((item) =>
    item.id === spanId ? [left, right] : [item],
  );
  return {
    sourceSpans,
    clips: syncClipsToSourceSpans(
      current.clips,
      current.sourceSpans,
      sourceSpans,
      bpm,
    ),
    effects: copyEffectStacks(current.effects, [
      [sourceClipEffectTrackId(spanId), sourceClipEffectTrackId(id)],
    ]),
  };
}

/**
 * Source clip `spanId` removed. Arrangement clips stay where they are; the
 * parts of them it filled show nothing until something fills them again.
 */
export function deleteSourceSpan(
  current: SourceClipProject,
  spanId: string,
): SourceClipPatch | undefined {
  if (!current.sourceSpans.some((item) => item.id === spanId)) {
    return undefined;
  }

  const sourceSpans = current.sourceSpans.filter((item) => item.id !== spanId);
  return {
    sourceSpans,
    clips: syncClipsToSourceSpans(
      current.clips,
      current.sourceSpans,
      sourceSpans,
      current.bpm,
    ),
  };
}
