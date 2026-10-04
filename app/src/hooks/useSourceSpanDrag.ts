import { type Dispatch, type SetStateAction, useEffect } from "react";
import { patchProjectState } from "../app/session-project.ts";
import type {
  ProjectState,
  SourceSpan,
  SourceSpanDragState,
} from "../app/types.ts";
import { findSourceTrackIdAt } from "../app/timeline-math.ts";
import { LANE_SELECTION_DRAG_THRESHOLD_PX } from "../lane-selection-gesture.ts";
import { dragSourceSpanInSpans } from "../source-span-edit.ts";
import { syncClipsToSourceSpans } from "../source-track-content.ts";

export type SourceSpanDragInputs = {
  sourceSpanDrag: SourceSpanDragState | null;
  setSourceSpanDrag: Dispatch<SetStateAction<SourceSpanDragState | null>>;
  dragPreviewSourceSpans: SourceSpan[] | null;
  setDragPreviewSourceSpans: Dispatch<SetStateAction<SourceSpan[] | null>>;
  sourceSpans: SourceSpan[];
  bpm: number;
  fps: number;
  snapUnit: number;
  snapEnabled: boolean;
  sourceTracksLocked: boolean;
  quarterPx: number;
  isWorkspaceReadOnlyRef: { current: boolean };
  refuseReadOnlyEdit: () => void;
  commitProjectChange: (
    label: string,
    update: (current: ProjectState) => ProjectState,
  ) => void;
};

// The source track rows on screen, top to bottom.
function getSourceTrackRows() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-source-track-drop-target="track"][data-source-track-id]',
    ),
    (row) => {
      const bounds = row.getBoundingClientRect();
      return {
        id: row.dataset.sourceTrackId ?? "",
        top: bounds.top,
        bottom: bounds.bottom,
      };
    },
  );
}

// Follows the pointer through a source clip move or edge trim, previewing it
// and the clips it overlaps until the release commits it as one undo step.
// A move follows the pointer onto other source track rows, like a layer clip
// onto other layers. A press released before the click threshold changes
// nothing.
export function useSourceSpanDrag({
  sourceSpanDrag,
  setSourceSpanDrag,
  dragPreviewSourceSpans,
  setDragPreviewSourceSpans,
  sourceSpans,
  bpm,
  fps,
  snapUnit,
  snapEnabled,
  sourceTracksLocked,
  quarterPx,
  isWorkspaceReadOnlyRef,
  refuseReadOnlyEdit,
  commitProjectChange,
}: SourceSpanDragInputs) {
  useEffect(() => {
    if (!sourceSpanDrag) {
      return;
    }

    // Locking the source tracks, here or by a collaborator, drops a drag in
    // progress without changing anything.
    if (sourceTracksLocked) {
      setDragPreviewSourceSpans(null);
      setSourceSpanDrag(null);
      return;
    }

    const origin = sourceSpans.find(
      (span) => span.id === sourceSpanDrag.spanId,
    );

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== sourceSpanDrag.pointerId || !origin) {
        return;
      }

      const deltaX = event.clientX - sourceSpanDrag.pointerStartX;
      const deltaY = event.clientY - sourceSpanDrag.pointerStartY;
      if (
        !dragPreviewSourceSpans &&
        Math.abs(deltaX) <= LANE_SELECTION_DRAG_THRESHOLD_PX &&
        (sourceSpanDrag.kind !== "move" ||
          Math.abs(deltaY) <= LANE_SELECTION_DRAG_THRESHOLD_PX)
      ) {
        return;
      }

      // A read-only tab never previews a move or trim; the drag ends and
      // asks to take over.
      if (isWorkspaceReadOnlyRef.current) {
        setSourceSpanDrag(null);
        refuseReadOnlyEdit();
        return;
      }

      const sourceTrackId =
        sourceSpanDrag.kind === "move"
          ? findSourceTrackIdAt(
              getSourceTrackRows(),
              event.clientY,
              origin.sourceTrackId,
            )
          : origin.sourceTrackId;
      setDragPreviewSourceSpans(
        dragSourceSpanInSpans(
          sourceSpans,
          origin,
          sourceSpanDrag.kind,
          deltaX / quarterPx,
          sourceTrackId,
          {
            bpm,
            fps,
            snapUnit,
            snap: snapEnabled && !event.shiftKey,
          },
        ),
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== sourceSpanDrag.pointerId) {
        return;
      }

      if (dragPreviewSourceSpans) {
        const spans = dragPreviewSourceSpans;
        commitProjectChange(
          sourceSpanDrag.kind === "move"
            ? "Move source clip"
            : "Trim source clip",
          (current) =>
            patchProjectState(current, {
              sourceSpans: spans,
              clips: syncClipsToSourceSpans(
                current.clips,
                current.sourceSpans,
                spans,
                bpm,
              ),
            }),
        );
      }

      setDragPreviewSourceSpans(null);
      setSourceSpanDrag(null);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== sourceSpanDrag.pointerId) {
        return;
      }

      setDragPreviewSourceSpans(null);
      setSourceSpanDrag(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [
    bpm,
    commitProjectChange,
    dragPreviewSourceSpans,
    fps,
    isWorkspaceReadOnlyRef,
    quarterPx,
    refuseReadOnlyEdit,
    setDragPreviewSourceSpans,
    setSourceSpanDrag,
    snapEnabled,
    snapUnit,
    sourceSpanDrag,
    sourceSpans,
    sourceTracksLocked,
  ]);
}
