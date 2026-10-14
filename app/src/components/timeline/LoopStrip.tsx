import {
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
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
import {
  isDoubleTap,
  quickLoopRegion,
  type TouchTap,
} from "../../mobile/timeline-touch.ts";
import { ContextMenu } from "../ContextMenu";
import { LoopRegionBar } from "./LoopRegionBar";

// How far the pointer moves before a press in the strip counts as a drag
// rather than a click that clears the selection.
const LOOP_STRIP_DRAG_THRESHOLD_PX = 3;

const stopMenuEvent = (event: SyntheticEvent) => event.stopPropagation();

// Opens the loop menu at a right-click's position, if it's in the strip.
export type OpenLoopMenu = (point: {
  clientX: number;
  clientY: number;
}) => void;

type LoopStripProps = {
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  mac: boolean;
  labelWidth: number;
  quarterPx: number;
  totalQuarters: number;
  barLength: number;
  snapUnit: number;
  snapEnabled: boolean;
  playbackSelection: PlaybackSelection | null;
  setPlaybackSelection: (selection: PlaybackSelection | null) => void;
  loopRegion: LoopRegion | null;
  setLoopRegion: (region: LoopRegion | null, label?: string) => void;
  previewLoopRegion: (region: LoopRegion | null) => void;
  lockPlaybackSelection: () => void;
  lockLoopShortcut: string;
  timelineContentEndQ: number;
  // Set to open the loop menu for a right-click the ruler row receives:
  // its pan captures the pointer, so the strip never sees the event.
  openMenuRef: RefObject<OpenLoopMenu | null>;
};

// The loop strip along the ruler's bottom edge, the playback selection's
// highlight and the loop region. Dragging in the strip selects a range
// without moving the playhead; a click clears it, and a double-click or
// double tap on the selection locks it into the loop region; elsewhere it
// loops the bar under the pointer. Right-clicking it opens the loop menu, and
// pan and zoom drags pass through to the ruler row.
export function LoopStrip({
  timelineScrollRef,
  mac,
  labelWidth,
  quarterPx,
  totalQuarters,
  barLength,
  snapUnit,
  snapEnabled,
  playbackSelection,
  setPlaybackSelection,
  loopRegion,
  setLoopRegion,
  previewLoopRegion,
  lockPlaybackSelection,
  lockLoopShortcut,
  timelineContentEndQ,
  openMenuRef,
}: LoopStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ anchor: MenuPoint; atQ: number } | null>(
    null,
  );
  const dragRef = useRef<{
    pointerId: number;
    tap: TouchTap;
    anchorQ: number;
    moved: boolean;
  } | null>(null);
  // The last click in the strip, and the selection it cleared if it was
  // inside one, which the press after it can lock as the second half of a
  // double-click or double tap.
  const clearedRef = useRef<{
    selection: PlaybackSelection | null;
    tap: TouchTap;
  } | null>(null);
  // Set by a mouse or pen press, so a dblclick a double tap fires is ignored.
  const doubleClickRef = useRef<{ selection: PlaybackSelection | null } | null>(
    null,
  );

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
    doubleClickRef.current = null;
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
    const tap = { x: event.clientX, y: event.clientY, timeMs: event.timeStamp };
    const cleared = clearedRef.current;
    clearedRef.current = null;
    // Browsers don't all fire dblclick for a double tap, and those that do
    // fire it at whatever the tap reveals, so taps never wait for one.
    if (event.pointerType === "touch") {
      if (cleared && isDoubleTap(cleared.tap, tap)) {
        lockOrLoopBar(cleared.selection, anchorQ);
        return;
      }
    } else {
      doubleClickRef.current = { selection: cleared?.selection ?? null };
    }

    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      tap,
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
      Math.abs(event.clientX - drag.tap.x) < LOOP_STRIP_DRAG_THRESHOLD_PX
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
      const inside =
        playbackSelection &&
        drag.anchorQ >= playbackSelection.startQ &&
        drag.anchorQ <= playbackSelection.endQ;
      clearedRef.current = {
        selection: inside ? playbackSelection : null,
        tap: drag.tap,
      };
      setPlaybackSelection(null);
    }
  };

  // Locks the selection the first click of a double-click cleared, as
  // Create loop area would have before that click, or with none loops the
  // bar at the pointer, as the phone's loop button does at the playhead.
  const lockOrLoopBar = (selection: PlaybackSelection | null, atQ: number) =>
    setLoopRegion(
      selection
        ? { ...selection }
        : quickLoopRegion(clamp(atQ, 0, totalQuarters), barLength),
    );

  // Opens the loop menu when the right-click lands in the strip.
  openMenuRef.current = (event) => {
    const bounds = stripRef.current?.getBoundingClientRect();
    const atQ = pointerQ(event.clientX);
    if (
      !bounds ||
      atQ === null ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      return;
    }

    setMenu({
      anchor: { x: event.clientX, y: event.clientY },
      atQ: clamp(
        snapQuarterValue(atQ, snapUnit, snapEnabled),
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
      marker === "in" ? "Set loop in marker" : "Set loop out marker",
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the loop strip menu's Create loop area is its equivalent */}
      <div
        ref={stripRef}
        className="ruler-loop-strip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          const doubleClick = doubleClickRef.current;
          doubleClickRef.current = null;
          const atQ = pointerQ(event.clientX);
          if (doubleClick && atQ !== null) {
            event.stopPropagation();
            lockOrLoopBar(doubleClick.selection, atQ);
          }
        }}
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
            previewLoopRegion={previewLoopRegion}
            setPlaybackSelection={setPlaybackSelection}
          />
        ) : null}
      </div>
      {/* The menu is portaled out of the ruler, but React still bubbles its
          events here; stop them before the ruler scrubs or pans on them. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only stops the menu's events from reaching the ruler */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the menu handles its own keys */}
      <div
        className="ruler-loop-strip__menu"
        onPointerDown={stopMenuEvent}
        onClick={stopMenuEvent}
        onDoubleClick={stopMenuEvent}
        onContextMenu={stopMenuEvent}
      >
        <ContextMenu
          anchor={menu?.anchor ?? null}
          entries={menu ? menuEntries(menu.atQ) : []}
          label="Loop actions"
          onClose={() => setMenu(null)}
        />
      </div>
    </>
  );
}
