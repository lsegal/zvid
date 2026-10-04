import {
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
} from "react";
import type { getShortcutLabels } from "../../app/shortcut-labels.ts";
import {
  getTimelinePointerX,
  pointerToTimelineQ,
  snapQuarterValue,
} from "../../app/timeline-math.ts";
import type {
  ArrangementClip,
  DragState,
  Lane,
  TimelineSelection,
} from "../../app/types.ts";
import { clamp } from "../../app/util.ts";
import { isContextMenuPress } from "../../context-menu.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { startLaneSelectionGesture } from "../../lane-selection-gesture.ts";
import type { useMenus } from "../../menus/useMenus.ts";
import { ClipCard, type ClipCardContext } from "./ClipCard";
import { arePropsEqualWithContexts } from "./memo-props.ts";
import { SelectionOverlay } from "./SelectionOverlay";
import "./lane-row.css";

// What every layer's lane in the arrangement shares.
export type LaneRowContext = {
  openLaneMenu: ReturnType<typeof useMenus>["openLaneMenu"];
  shortcutLabels: ReturnType<typeof getShortcutLabels>;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  labelWidth: number;
  quarterPx: number;
  totalQuarters: number;
  snapUnit: number;
  snapEnabled: boolean;
  gridStyle: ReturnType<typeof useTimelineViewport>["gridStyle"];
  pendingSelection: TimelineSelection | null;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedLaneId: Dispatch<SetStateAction<string | undefined>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setDragPreviewClips: Dispatch<SetStateAction<ArrangementClip[] | null>>;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
  clipCard: ClipCardContext;
};

type LaneRowProps = {
  lane: Lane;
  // The layer's clips, in timeline order.
  clips: ArrangementClip[];
} & LaneRowContext;

// A layer's lane: its clips and range selection. Pressing empty lane space
// selects the layer and starts a range selection, or seeks on a click;
// pressing the selection moves or resizes it.
export const LaneRow = memo(function LaneRow({
  lane,
  clips,
  openLaneMenu,
  shortcutLabels,
  timelineScrollRef,
  labelWidth,
  quarterPx,
  totalQuarters,
  snapUnit,
  snapEnabled,
  gridStyle,
  pendingSelection,
  setPendingSelection,
  setSelectedClipId,
  setSelectedLaneId,
  setIsPlaying,
  setDragPreviewClips,
  setDragState,
  clipCard,
}: LaneRowProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click is a pointer shortcut; the context-menu key and Shift+F10 open the same menu on the selected layer
    <div
      className="track-row__content track-row__content--arrangement"
      data-timeline-lane-id={lane.id}
      onContextMenu={(event) => openLaneMenu(event, lane.id)}
      onPointerDown={(event) => {
        // Right-click, or Ctrl-click on macOS, opens the lane menu instead.
        if (
          event.target !== event.currentTarget ||
          isContextMenuPress(event, shortcutLabels.mac)
        ) {
          return;
        }

        event.preventDefault();
        setSelectedClipId(undefined);
        setSelectedLaneId(lane.id);
        setIsPlaying(false);
        setDragPreviewClips(null);

        const timelineScroll = timelineScrollRef.current;
        if (!timelineScroll) {
          return;
        }

        const pointerX = getTimelinePointerX(timelineScroll, event.clientX);
        const anchorQ = snapQuarterValue(
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
          snapEnabled && !event.shiftKey,
        );
        // The selection starts once the pointer drags
        // past the threshold; until then it's a click.
        setPendingSelection(null);
        setDragState({
          kind: "selection",
          pointerId: event.pointerId,
          laneId: lane.id,
          gesture: startLaneSelectionGesture(anchorQ, event.clientX),
        });
      }}
      style={gridStyle}
    >
      {pendingSelection?.laneId === lane.id ? (
        <SelectionOverlay
          selection={pendingSelection}
          quarterPx={quarterPx}
          onEditPress={(event, edit) => {
            // Right-click opens the selection menu through the lane, and
            // the other buttons pan the timeline.
            if (
              event.button !== 0 ||
              isContextMenuPress(event, shortcutLabels.mac)
            ) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            setIsPlaying(false);
            setDragState({
              kind: "selection-edit",
              pointerId: event.pointerId,
              edit,
              pointerStartX: event.clientX,
              pointerStartY: event.clientY,
              origin: pendingSelection,
              dragging: false,
            });
          }}
        />
      ) : null}
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} {...clipCard} />
      ))}
    </div>
  );
}, arePropsEqualWithContexts<LaneRowProps>("clipCard"));
