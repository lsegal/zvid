import { type Dispatch, type SetStateAction, useEffect } from "react";
import { cloneClipAtStartQ } from "../app/clip-ops.ts";
import { TIMELINE_DRAG_EPSILON } from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import {
  findClosestTimelineLaneId,
  pointerToTimelineQ,
  resolveClipOverlapPreview,
  snapQuarterValue,
} from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  DragState,
  ProjectState,
  TimelineSelection,
} from "../app/types.ts";
import { clamp } from "../app/util.ts";
import { copyClipEffects } from "../fx-stack";
import {
  LANE_SELECTION_DRAG_THRESHOLD_PX,
  moveLaneSelectionGesture,
  releaseLaneSelectionGesture,
} from "../lane-selection-gesture.ts";

export type ClipDragInputs = {
  dragState: DragState | null;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
  dragPreviewClips: ArrangementClip[] | null;
  setDragPreviewClips: Dispatch<SetStateAction<ArrangementClip[] | null>>;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  clips: ArrangementClip[];
  bpm: number;
  beatUnit: number;
  snapUnit: number;
  snapEnabled: boolean;
  quarterPx: number;
  totalQuarters: number;
  labelWidth: number;
  timelineScrollRef: { current: HTMLDivElement | null };
  playbackOriginRef: { current: number };
  isWorkspaceReadOnlyRef: { current: boolean };
  refuseReadOnlyEdit: () => void;
  setPlayheadQ: (nextPlayheadQ: number) => void;
  jumpToClipStart: (clipId: string) => void;
  commitProjectChange: (
    label: string,
    update: (current: ProjectState) => ProjectState,
  ) => void;
};

// Follows the pointer through a lane selection, clip move or duplicate, or
// trim started in the timeline, previewing it until the release commits it.
export function useClipDrag({
  dragState,
  setDragState,
  dragPreviewClips,
  setDragPreviewClips,
  setPendingSelection,
  setSelectedClipId,
  clips,
  bpm,
  beatUnit,
  snapUnit,
  snapEnabled,
  quarterPx,
  totalQuarters,
  labelWidth,
  timelineScrollRef,
  playbackOriginRef,
  isWorkspaceReadOnlyRef,
  refuseReadOnlyEdit,
  setPlayheadQ,
  jumpToClipStart,
  commitProjectChange,
}: ClipDragInputs) {
  const minimumWindowQ = Math.max(snapUnit, beatUnit / 4);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      const shouldSnap = snapEnabled && !event.shiftKey;

      if (dragState.kind === "selection") {
        const timelineScroll = timelineScrollRef.current;
        if (!timelineScroll) {
          return;
        }

        const timelineBounds = timelineScroll.getBoundingClientRect();
        const pointerX = event.clientX - timelineBounds.left;
        const nextQ = snapQuarterValue(
          clamp(
            pointerToTimelineQ(
              pointerX,
              timelineScroll.scrollLeft,
              labelWidth,
              quarterPx,
            ),
            0,
            totalQuarters,
          ),
          snapUnit,
          shouldSnap,
        );
        const { gesture, selection } = moveLaneSelectionGesture(
          dragState.gesture,
          event.clientX,
          nextQ,
          minimumWindowQ,
        );
        if (!selection) {
          return;
        }
        if (gesture !== dragState.gesture) {
          setDragState({ ...dragState, gesture });
        }
        setPendingSelection({
          id: `selection-${dragState.laneId}`,
          laneId: dragState.laneId,
          ...selection,
        });
        return;
      }

      // A read-only tab never previews a move or trim. Once the pointer
      // passes the click threshold, the drag ends and asks to take over.
      if (isWorkspaceReadOnlyRef.current) {
        if (
          Math.abs(event.clientX - dragState.pointerStartX) >
          LANE_SELECTION_DRAG_THRESHOLD_PX
        ) {
          if (dragState.kind === "move" && dragState.duplicateOnDrag) {
            setSelectedClipId(dragState.sourceClipId);
          }
          setDragState(null);
          refuseReadOnlyEdit();
        }
        return;
      }

      const deltaQuarters =
        (event.clientX - dragState.pointerStartX) / quarterPx;

      if (dragState.kind === "move") {
        const nextStartQ = clamp(
          snapQuarterValue(
            dragState.originStartQ + deltaQuarters,
            snapUnit,
            shouldSnap,
          ),
          0,
          Math.max(0, totalQuarters - dragState.originDurationQ - beatUnit),
        );
        const timelineScroll = timelineScrollRef.current;
        const nextLaneId = timelineScroll
          ? findClosestTimelineLaneId(
              timelineScroll,
              event.clientY,
              dragState.originLaneId,
            )
          : dragState.originLaneId;

        if (dragState.duplicateOnDrag) {
          if (
            nextLaneId === dragState.originLaneId &&
            Math.abs(nextStartQ - dragState.originStartQ) <=
              TIMELINE_DRAG_EPSILON
          ) {
            setDragPreviewClips(null);
            return;
          }

          const sourceClip = clips.find(
            (clip) => clip.id === dragState.sourceClipId,
          );
          if (!sourceClip) {
            return;
          }

          setDragPreviewClips(
            resolveClipOverlapPreview(
              [
                ...clips,
                cloneClipAtStartQ(
                  sourceClip,
                  bpm,
                  dragState.originStartQ,
                  dragState.clipId,
                ),
              ],
              dragState.clipId,
              nextStartQ,
              dragState.originDurationQ,
              bpm,
              nextLaneId,
            ),
          );
          return;
        }

        setDragPreviewClips(
          resolveClipOverlapPreview(
            clips,
            dragState.clipId,
            nextStartQ,
            dragState.originDurationQ,
            bpm,
            nextLaneId,
          ),
        );
        return;
      }

      if (dragState.kind === "resize-start") {
        const fixedEndQ = dragState.originStartQ + dragState.originDurationQ;
        const nextStartQ = clamp(
          snapQuarterValue(
            dragState.originStartQ + deltaQuarters,
            snapUnit,
            shouldSnap,
          ),
          0,
          fixedEndQ - minimumWindowQ,
        );
        const nextDurationQ = Math.max(minimumWindowQ, fixedEndQ - nextStartQ);

        setDragPreviewClips(
          resolveClipOverlapPreview(
            clips,
            dragState.clipId,
            nextStartQ,
            nextDurationQ,
            bpm,
          ),
        );
        return;
      }

      const rawEndQ =
        dragState.originStartQ + dragState.originDurationQ + deltaQuarters;
      const nextEndQ = snapQuarterValue(rawEndQ, snapUnit, shouldSnap);
      const nextDurationQ = Math.max(
        minimumWindowQ,
        nextEndQ - dragState.originStartQ,
      );

      setDragPreviewClips(
        resolveClipOverlapPreview(
          clips,
          dragState.clipId,
          dragState.originStartQ,
          nextDurationQ,
          bpm,
        ),
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      // A press released before it became a drag is a click: it seeks
      // instead of leaving a selection behind.
      if (dragState.kind === "selection") {
        const release = releaseLaneSelectionGesture(dragState.gesture);
        if (release.kind === "click") {
          setPendingSelection(null);
          setPlayheadQ(release.playheadQ);
          playbackOriginRef.current = release.playheadQ;
        }
      }

      if (dragState.kind !== "selection" && dragPreviewClips) {
        const historyLabel =
          dragState.kind === "move"
            ? dragState.duplicateOnDrag
              ? "Duplicate clip"
              : "Move clip"
            : dragState.kind === "resize-start"
              ? "Trim clip start"
              : "Trim clip end";
        commitProjectChange(historyLabel, (current) =>
          patchProjectState(current, {
            clips: dragPreviewClips,
            // A clip duplicated by dragging gets a copy of the stack.
            ...(dragState.kind === "move" && dragState.duplicateOnDrag
              ? {
                  effects: copyClipEffects(current.effects, [
                    [dragState.sourceClipId, dragState.clipId],
                  ]),
                }
              : {}),
          }),
        );
      }

      if (
        dragState.kind === "move" &&
        dragState.duplicateOnDrag &&
        !dragPreviewClips
      ) {
        setSelectedClipId(dragState.sourceClipId);
        // Released where it was pressed, a Ctrl/Cmd-press is a click.
        if (
          dragState.jumpOnClick &&
          Math.abs(event.clientX - dragState.pointerStartX) <=
            LANE_SELECTION_DRAG_THRESHOLD_PX
        ) {
          jumpToClipStart(dragState.sourceClipId);
        }
      }

      setDragPreviewClips(null);
      setDragState(null);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      if (
        dragState.kind === "move" &&
        dragState.duplicateOnDrag &&
        !dragPreviewClips
      ) {
        setSelectedClipId(dragState.sourceClipId);
      }

      setDragPreviewClips(null);
      setDragState(null);
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
    beatUnit,
    bpm,
    clips,
    commitProjectChange,
    dragPreviewClips,
    dragState,
    jumpToClipStart,
    minimumWindowQ,
    refuseReadOnlyEdit,
    setPlayheadQ,
    snapEnabled,
    labelWidth,
    quarterPx,
    snapUnit,
    totalQuarters,
    isWorkspaceReadOnlyRef,
    playbackOriginRef,
    setDragPreviewClips,
    setDragState,
    setPendingSelection,
    setSelectedClipId,
    timelineScrollRef,
  ]);
}
