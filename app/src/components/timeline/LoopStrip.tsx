import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useRef,
  useState,
} from "react";
import {
  type LoopMarker,
  type LoopRegion,
  placeLoopMarker,
} from "../../app/loop-region.ts";
import {
  type PlaybackSelection,
  playbackSelectionFromDrag,
} from "../../app/playback-selection.ts";
import {
  getTimelinePointerX,
  pointerToTimelineQ,
  snapQuarterValue,
} from "../../app/timeline-math.ts";
import { clamp } from "../../app/util.ts";
import type { ContextMenuEntry, MenuPoint } from "../../context-menu.ts";
import { isRulerPanPress } from "../../drag-scroll.ts";
import { ContextMenu } from "../ContextMenu";
import { LoopRegionBar } from "./LoopRegionBar";

// How far the pointer moves before a press in the strip counts as a drag
// rather than a click that clears the selection.
const LOOP_STRIP_DRAG_THRESHOLD_PX = 3;

type LoopStripProps = {
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  mac: boolean;
  labelWidth: number;
  quarterPx: number;
  totalQuarters: number;
  snapUnit: number;
  snapEnabled: boolean;
  playbackSelection: PlaybackSelection | null;
  setPlaybackSelection: (selection: PlaybackSelection | null) => void;
  loopRegion: LoopRegion | null;
  setLoopRegion: (region: LoopRegion | null) => void;
  lockPlaybackSelection: () => void;
  lockLoopShortcut: string;
  timelineContentEndQ: number;
  // Swallows the contextmenu a ruler pan ends with; returns whether it did.
  consumePanContextMenu: (event: MouseEvent<HTMLElement>) => boolean;
};

// The loop strip along the ruler's bottom edge, the playback selection's
// highlight and the loop region. Dragging in the strip selects a range
// without moving the playhead; a click clears it. Right-clicking it opens
// the loop menu, and pan and zoom drags pass through to the ruler row.
export function LoopStrip({
  timelineScrollRef,
  mac,
  labelWidth,
  quarterPx,
  totalQuarters,
  snapUnit,
  snapEnabled,
  playbackSelection,
  setPlaybackSelection,
  loopRegion,
  setLoopRegion,
  lockPlaybackSelection,
  lockLoopShortcut,
  timelineContentEndQ,
  consumePanContextMenu,
}: LoopStripProps) {
  const [menu, setMenu] = useState<{ anchor: MenuPoint; atQ: number } | null>(
    null,
  );
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    anchorQ: number;
    moved: boolean;
  } | null>(null);

  const pointerQ = (clientX: number) => {
    const timelineScroll = timelineScrollRef.current;
    if (!timelineScroll) {
      return null;
    }

    return pointerToTimelineQ(
      getTimelinePointerX(timelineScroll, clientX),
      timelineScroll.scrollLeft,
      labelWidth,
      quarterPx,
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isRulerPanPress(event, mac)) {
      return;
    }

    const anchorQ = pointerQ(event.clientX);
    if (anchorQ === null) {
      return;
    }

    // The ruler's scrub handler never sees the press.
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      anchorQ,
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (
      !drag.moved &&
      Math.abs(event.clientX - drag.startX) < LOOP_STRIP_DRAG_THRESHOLD_PX
    ) {
      return;
    }

    drag.moved = true;
    const currentQ = pointerQ(event.clientX);
    if (currentQ === null) {
      return;
    }

    setPlaybackSelection(
      playbackSelectionFromDrag(drag.anchorQ, currentQ, {
        snapUnit,
        snap: snapEnabled && !event.shiftKey,
        totalQuarters,
      }),
    );
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    if (!drag.moved && event.type === "pointerup") {
      setPlaybackSelection(null);
    }
  };

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (consumePanContextMenu(event)) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const fromKeyboard = !event.clientX && !event.clientY;
    const atQ = fromKeyboard ? null : pointerQ(event.clientX);
    setMenu({
      anchor: fromKeyboard
        ? { x: bounds.left, y: bounds.bottom }
        : { x: event.clientX, y: event.clientY },
      atQ: clamp(
        snapQuarterValue(atQ ?? 0, snapUnit, snapEnabled),
        0,
        totalQuarters,
      ),
    });
  };

  const placeMarker = (marker: LoopMarker, atQ: number) =>
    setLoopRegion(
      placeLoopMarker(loopRegion, marker, atQ, {
        contentEndQ: timelineContentEndQ,
        minimumQ: snapUnit,
        totalQuarters,
      }),
    );

  const menuEntries = (atQ: number): ContextMenuEntry[] => [
    {
      type: "item",
      id: "loop-in",
      label: "Create loop in marker",
      onSelect: () => placeMarker("in", atQ),
    },
    {
      type: "item",
      id: "loop-out",
      label: "Create loop out marker",
      onSelect: () => placeMarker("out", atQ),
    },
    {
      type: "item",
      id: "loop-area",
      label: "Create loop area",
      shortcut: lockLoopShortcut,
      disabled: !playbackSelection,
      title: playbackSelection
        ? undefined
        : "Drag in the loop strip to select a range first",
      onSelect: lockPlaybackSelection,
    },
    { type: "separator" },
    {
      type: "item",
      id: "loop-delete",
      label: "Delete loop",
      disabled: !loopRegion,
      onSelect: () => setLoopRegion(null),
    },
  ];

  const selectionStyle = playbackSelection
    ? {
        left: playbackSelection.startQ * quarterPx,
        width: (playbackSelection.endQ - playbackSelection.startQ) * quarterPx,
      }
    : null;

  return (
    <>
      {selectionStyle ? (
        <div className="ruler-playback-selection" style={selectionStyle} />
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the strip's drag and menu are pointer shortcuts; L locks the selection from the keyboard */}
      <div
        className="ruler-loop-strip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={onContextMenu}
      >
        {playbackSelection && selectionStyle ? (
          <div
            className="ruler-loop-strip__selection"
            data-start-q={playbackSelection.startQ}
            data-end-q={playbackSelection.endQ}
            style={selectionStyle}
          />
        ) : null}
        {loopRegion ? (
          <LoopRegionBar
            mac={mac}
            quarterPx={quarterPx}
            totalQuarters={totalQuarters}
            snapUnit={snapUnit}
            snapEnabled={snapEnabled}
            loopRegion={loopRegion}
            setLoopRegion={setLoopRegion}
          />
        ) : null}
      </div>
      <ContextMenu
        anchor={menu?.anchor ?? null}
        entries={menu ? menuEntries(menu.atQ) : []}
        label="Loop actions"
        onClose={() => setMenu(null)}
      />
    </>
  );
}
