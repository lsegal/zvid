import {
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
  useRef,
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
import {
  gridCellSelection,
  startLaneSelectionGesture,
} from "../../lane-selection-gesture.ts";
import type { useMenus } from "../../menus/useMenus.ts";
import { isDoubleTap, type TouchTap } from "../../mobile/timeline-touch.ts";
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
  // The finest grid cell drawn, which a double-click or double-tap selects.
  gridCellQ: number;
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
  // A collapsed lane's clips are plain bars, without frames or waveforms.
  collapsed: boolean;
} & LaneRowContext;

// A layer's lane: its clips and range selection. Pressing empty lane space
// selects the layer and starts a range selection, or seeks on a click;
// double-clicking or double-tapping it selects one grid cell; pressing the
// selection moves or resizes it.
export const LaneRow = memo(function LaneRow({
  lane,
  clips,
  collapsed,
  openLaneMenu,
  shortcutLabels,
  timelineScrollRef,
  labelWidth,
  quarterPx,
  totalQuarters,
  snapUnit,
  snapEnabled,
  gridCellQ,
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
  // Touch presses on a tablet, so a second tap can tell it's a double tap.
  const lastTapRef = useRef<TouchTap | null>(null);

  // The press's time on the timeline, unsnapped.
  const pointerQ = (timelineScroll: HTMLDivElement, clientX: number) =>
    clamp(
      pointerToTimelineQ(
        getTimelinePointerX(timelineScroll, clientX),
        timelineScroll.scrollLeft,
        labelWidth,
        quarterPx,
      ),
      0,
      totalQuarters,
    );

  // Selects the grid cell under `clientX`, as a drag would select a range.
  const selectGridCell = (clientX: number) => {
    const timelineScroll = timelineScrollRef.current;
    if (!timelineScroll) {
      return;
    }
    setSelectedClipId(undefined);
    setSelectedLaneId(lane.id);
    setDragPreviewClips(null);
    setDragState(null);
    setPendingSelection(
      gridCellSelection(
        lane.id,
        pointerQ(timelineScroll, clientX),
        gridCellQ,
        quarterPx,
      ),
    );
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click is a pointer shortcut; the context-menu key and Shift+F10 open the same menu on the selected layer
    <div
      className="track-row__content track-row__content--arrangement"
      data-timeline-lane-id={lane.id}
      onContextMenu={(event) => openLaneMenu(event, lane.id)}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget && event.button === 0) {
          selectGridCell(event.clientX);
        }
      }}
      onPointerDown={(event) => {
        // Right-click, or Ctrl-click on macOS, opens the lane menu instead.
        if (
          event.target !== event.currentTarget ||
          isContextMenuPress(event, shortcutLabels.mac)
        ) {
          return;
        }

        event.preventDefault();
        setIsPlaying(false);
        // Browsers don't all fire dblclick for a double tap.
        if (event.pointerType === "touch") {
          const tap = {
            x: event.clientX,
            y: event.clientY,
            timeMs: event.timeStamp,
          };
          if (isDoubleTap(lastTapRef.current, tap)) {
            lastTapRef.current = null;
            selectGridCell(event.clientX);
            return;
          }
          lastTapRef.current = tap;
        }
        setSelectedClipId(undefined);
        setSelectedLaneId(lane.id);
        setDragPreviewClips(null);

        const timelineScroll = timelineScrollRef.current;
        if (!timelineScroll) {
          return;
        }

        const anchorQ = snapQuarterValue(
          pointerQ(timelineScroll, event.clientX),
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
          pointerStartY:
            event.pointerType === "touch" ? undefined : event.clientY,
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
        <ClipCard
          key={clip.id}
          clip={clip}
          collapsed={collapsed}
          {...clipCard}
        />
      ))}
    </div>
  );
}, arePropsEqualWithContexts<LaneRowProps>("clipCard"));
