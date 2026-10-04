import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";
import { SIGNATURES } from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import type { SourceSelection } from "../app/source-selection.ts";
import type { ProjectState, SourceSpan, TimelineMode } from "../app/types.ts";
import type { MediaItem } from "../media";
import {
  editSourceClipField,
  getSourceClipLimits,
  getSourceClipValues,
  isSourceClipMediaOffline,
  SOURCE_CLIP_HISTORY_LABELS,
  type SourceClipField,
} from "../source-clip-properties.ts";
import { relinkClipsToSourceSpans } from "../source-span-edit.ts";
import type { TimeValueFormat } from "../time-value.ts";
import { useMediaDurationSeconds } from "./useMediaDurationSeconds.ts";

export type SourceClipPropertiesInputs = {
  sourceSelection: SourceSelection | undefined;
  // The committed spans edits resolve against, and the spans the timeline
  // draws, which include a drag's or an edit's live preview.
  sourceSpans: SourceSpan[];
  timelineSourceSpans: SourceSpan[];
  setDragPreviewSourceSpans: Dispatch<SetStateAction<SourceSpan[] | null>>;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  timelineMode: TimelineMode;
  signatureId: string;
  bpm: number;
  fps: number;
  totalQuarters: number;
  isWorkspaceReadOnlyRef: { current: boolean };
  refuseReadOnlyEdit: () => void;
  commitProjectChange: (
    label: string,
    update: (current: ProjectState) => ProjectState,
  ) => void;
};

// The Source Clip Properties row for the selected source clip, or null when
// none is selected. Dragging or holding an arrow key on a field previews the
// edit, and the overlaps it resolves, on the timeline; the commit that ends
// the gesture records it as one undo step.
export function useSourceClipProperties({
  sourceSelection,
  sourceSpans,
  timelineSourceSpans,
  setDragPreviewSourceSpans,
  mediaItemsById,
  timelineMode,
  signatureId,
  bpm,
  fps,
  totalQuarters,
  isWorkspaceReadOnlyRef,
  refuseReadOnlyEdit,
  commitProjectChange,
}: SourceClipPropertiesInputs) {
  const spanId = sourceSelection?.sourceSpanId;
  const committedSpan = sourceSpans.find((span) => span.id === spanId);
  const shownSpan =
    timelineSourceSpans.find((span) => span.id === spanId) ?? committedSpan;
  const media = committedSpan?.mediaId
    ? mediaItemsById.get(committedSpan.mediaId)
    : undefined;
  const mediaDurationSeconds = useMediaDurationSeconds(media);

  const limits = useMemo(
    () =>
      committedSpan &&
      getSourceClipLimits(committedSpan, {
        bpm,
        fps,
        timelineLengthQ: totalQuarters,
        mediaDurationSeconds,
      }),
    [bpm, committedSpan, fps, mediaDurationSeconds, totalQuarters],
  );

  const setField = useCallback(
    (field: SourceClipField, valueQ: number, commit: boolean) => {
      if (!spanId) {
        return;
      }
      if (!commit) {
        // A read-only tab previews nothing; the commit asks to take over.
        if (!isWorkspaceReadOnlyRef.current) {
          setDragPreviewSourceSpans(
            editSourceClipField(sourceSpans, spanId, field, valueQ, bpm),
          );
        }
        return;
      }

      setDragPreviewSourceSpans(null);
      if (isWorkspaceReadOnlyRef.current) {
        refuseReadOnlyEdit();
        return;
      }
      commitProjectChange(SOURCE_CLIP_HISTORY_LABELS[field], (current) => {
        const spans = editSourceClipField(
          current.sourceSpans,
          spanId,
          field,
          valueQ,
          bpm,
        );
        return spans === current.sourceSpans
          ? current
          : patchProjectState(current, {
              sourceSpans: spans,
              clips: relinkClipsToSourceSpans(
                current.clips,
                current.sourceSpans,
                spans,
                bpm,
              ),
            });
      });
    },
    [
      bpm,
      commitProjectChange,
      isWorkspaceReadOnlyRef,
      refuseReadOnlyEdit,
      setDragPreviewSourceSpans,
      sourceSpans,
      spanId,
    ],
  );

  if (!committedSpan || !shownSpan || !limits) {
    return null;
  }

  const signature =
    SIGNATURES.find((candidate) => candidate.id === signatureId) ??
    SIGNATURES[0];
  const format: TimeValueFormat = { timelineMode, bpm, signature, fps };

  return {
    clipName: committedSpan.label,
    accent: committedSpan.accent,
    format,
    values: getSourceClipValues(shownSpan, bpm),
    limits,
    // Offline as the clip's card shows it. Media that is still loading or of
    // unknown length is not offline, though its limits still fall back to the
    // clip's current values until its length is known.
    mediaOffline: isSourceClipMediaOffline(committedSpan, media),
    setField,
  };
}

export type SourceClipPropertiesModel = NonNullable<
  ReturnType<typeof useSourceClipProperties>
>;
