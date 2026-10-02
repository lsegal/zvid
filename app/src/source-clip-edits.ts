// Pasting, duplicating, splitting and deleting source clips (source spans)
// from their right-click menu and the keyboard shortcuts. Each returns the
// project patch for one undo step. Pieces placed onto other spans in the same
// source track overwrite them as a moved span does, and the arrangement
// clips that use the spans are relinked to match.
import type { ClipClipboard } from "./app/clip-ops.ts";
import { getClipEndQ, secondsToQuarters } from "./app/timeline-math.ts";
import type { ProjectState, SourceSpan } from "./app/types.ts";
import { getSwatch } from "./app/util.ts";
import { canSplitAt } from "./clip-menu.ts";
import {
  clipEffectTrackId,
  copyEffectStacks,
  sourceClipEffectTrackId,
} from "./fx-stack.ts";
import {
  relinkClipsToSourceSpans,
  resolveSourceSpanOverlaps,
  retimeSourceSpan,
} from "./source-span-edit.ts";

export type SourceClipProject = Pick<
  ProjectState,
  "bpm" | "clips" | "effects" | "sourceSpans" | "sourceTracks"
>;

export type SourceClipPatch = Partial<
  Pick<ProjectState, "clips" | "effects" | "sourceSpans" | "sourceTracks">
>;

/**
 * Whether `clipboard` can be pasted into a source track: it was copied from
 * a source clip, or holds only media clips. Fill, text and FX clips have no
 * media to play there.
 */
export function canPasteIntoSourceTrack(
  clipboard: ClipClipboard | null,
): clipboard is ClipClipboard {
  if (!clipboard) {
    return false;
  }
  return (
    clipboard.sourceSpan !== undefined ||
    (clipboard.fragments.length > 0 &&
      clipboard.fragments.every((fragment) => fragment.clip.kind === undefined))
  );
}

// `spans` placed in order, each overwriting what it lands on in its track,
// with the arrangement clips relinked and each `[from, to]` stack copied
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
    clips: relinkClipsToSourceSpans(
      current.clips,
      current.sourceSpans,
      nextSpans,
      current.bpm,
    ),
    effects: copyEffectStacks(current.effects, copies, stackSource),
  };
}

/**
 * Pastes `clipboard` into source track `trackId` from `pasteQ` as new source
 * clips, keeping its pieces' spacing: the source clip it was copied from, or
 * each media clip's shown media. Each takes the stack it was copied with.
 * Undefined when there is nothing to paste there.
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

  const { bpm } = current;
  const swatch = getSwatch(track.colorIndex);
  const copies: Array<[string, string]> = [];
  const spans: SourceSpan[] = [];
  if (clipboard.sourceSpan) {
    const id = createId();
    copies.push([
      sourceClipEffectTrackId(clipboard.sourceSpan.id),
      sourceClipEffectTrackId(id),
    ]);
    spans.push({
      ...clipboard.sourceSpan,
      id,
      sourceTrackId: trackId,
      startQ: pasteQ,
      tint: swatch.color,
      accent: swatch.accent,
    });
  } else {
    for (const { clip, offsetQ } of clipboard.fragments) {
      // Only the part of the clip that shows media becomes the source clip.
      const startSeconds = Math.max(
        clip.trimStartSeconds,
        clip.sourceWindowStartSeconds,
      );
      const endSeconds = Math.min(
        clip.trimStartSeconds + clip.durationSeconds,
        clip.sourceWindowEndSeconds,
      );
      if (endSeconds <= startSeconds) {
        continue;
      }

      const id = createId();
      copies.push([clipEffectTrackId(clip.id), sourceClipEffectTrackId(id)]);
      spans.push({
        id,
        sourceTrackId: trackId,
        label: clip.label,
        mediaPath: clip.mediaPath,
        ...(clip.mediaId ? { mediaId: clip.mediaId } : {}),
        startQ:
          pasteQ +
          offsetQ +
          secondsToQuarters(startSeconds - clip.trimStartSeconds, bpm),
        durationSeconds: endSeconds - startSeconds,
        trimStartSeconds: startSeconds,
        ...(clip.warp ? { warp: clip.warp } : {}),
        tint: swatch.color,
        accent: swatch.accent,
      });
    }
  }
  if (!spans.length) {
    return undefined;
  }

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
 * clips that start playing its media in the new piece move to it. Undefined
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
  const clips = current.clips.map((clip) =>
    clip.sourceSpanId === spanId &&
    clip.trimStartSeconds >= right.trimStartSeconds - 1e-6
      ? { ...clip, sourceSpanId: id }
      : clip,
  );
  return {
    sourceSpans,
    clips: relinkClipsToSourceSpans(
      clips,
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
 * Source clip `spanId` removed. Arrangement clips that used it are relinked
 * as when an overlap removes a span.
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
    clips: relinkClipsToSourceSpans(
      current.clips,
      current.sourceSpans,
      sourceSpans,
      current.bpm,
    ),
  };
}
