import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useState,
} from "react";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import { isContextMenuPress } from "../../context-menu.ts";
import { isRulerPanPress } from "../../drag-scroll.ts";
import {
  dragMidiTimeline,
  MIDI_TIMELINE_MIN_Q,
  type MidiClipTimeline,
  type MidiTimelineHandle,
  sameMidiTimeline,
} from "../../midi-clip-timeline.ts";
import { midiHistoryLabels } from "../../midi-editing.ts";
import { formatMusicalPosition } from "../../timeline-format.ts";
import { chainHandlers } from "../../use-drag-scroll";
import type { FxEditMode } from "../fx/types";
import { usePianoRollRulerPan } from "./use-piano-roll-pan";

// The piano roll counts bars of four quarters, like its grid.
const ROLL_SIGNATURE = { numerator: 4, denominator: 4 };

type PianoRollRulerProps = {
  timeline: MidiClipTimeline;
  // How many quarters the roll shows, and a quarter's width.
  viewQ: number;
  quarterPx: number;
  // The roll's zoom, which right-dragging the ruler up or down changes.
  zoom: number;
  onZoom: (zoom: number) => void;
  // The roll's scroller, which a drag on the ruler pans.
  scrollRef: RefObject<HTMLElement | null>;
  onChange: (
    timeline: MidiClipTimeline,
    label: string,
    mode: FxEditMode,
  ) => void;
};

type RulerDrag = {
  pointerId: number;
  handle: MidiTimelineHandle;
  startX: number;
  from: MidiClipTimeline;
  timeline: MidiClipTimeline;
};

const HANDLE_NAMES: Record<Exclude<MidiTimelineHandle, "loop">, string> = {
  start: "Start marker",
  length: "Clip end",
  loopStart: "Loop start",
  loopEnd: "Loop end",
};

// The quarter each bar the roll shows starts on.
function barStarts(viewQ: number) {
  return Array.from({ length: Math.ceil(viewQ / 4) }, (_, bar) => bar * 4);
}

function historyLabel(handle: MidiTimelineHandle) {
  return handle === "loop"
    ? midiHistoryLabels.moveLoop
    : midiHistoryLabels.timeline[handle];
}

// The piano roll's own timeline bar, in bars.beats like Live's: the loop
// brace across the top, which drags as a whole or by either edge, and the
// Start marker and the clip's end below it. Each marker is a slider whose
// arrow keys step it a sixteenth (a beat with Shift); every drag or step is
// one undo step. Dragging anywhere else, or with the middle button, pans the
// roll left and right; a right-drag or Ctrl-drag (macOS) also zooms when it
// moves up or down, around the time under the pointer.
export function PianoRollRuler({
  timeline,
  viewQ,
  quarterPx,
  zoom,
  onZoom,
  scrollRef,
  onChange,
}: PianoRollRulerProps) {
  const [drag, setDrag] = useState<RulerDrag | null>(null);
  const { mac } = getShortcutLabels();
  const pan = usePianoRollRulerPan({
    scrollRef,
    canStart: (event) =>
      isRulerPanPress(event, mac) ||
      (event.button === 0 &&
        !(event.target as Element).closest("[data-ruler-handle]")),
    isZoomPress: (event) => isContextMenuPress(event, mac),
    viewQ,
    quarterPx,
    zoom,
    onZoom,
  });
  const shown = drag?.timeline ?? timeline;
  const at = (valueQ: number) => valueQ * quarterPx;

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isContextMenuPress(event, mac)) {
      return;
    }
    const element = (event.target as Element).closest<HTMLElement>(
      "[data-ruler-handle]",
    );
    if (!element) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      handle: element.dataset.rulerHandle as MidiTimelineHandle,
      startX: event.clientX,
      from: timeline,
      timeline,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const next = dragMidiTimeline(
      drag.from,
      drag.handle,
      (event.clientX - drag.startX) / quarterPx,
    );
    if (!sameMidiTimeline(next, drag.timeline)) {
      setDrag({ ...drag, timeline: next });
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    setDrag(null);
    if (commit && !sameMidiTimeline(drag.timeline, drag.from)) {
      onChange(drag.timeline, historyLabel(drag.handle), "commit");
    }
  }

  function handleKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
    handle: Exclude<MidiTimelineHandle, "loop">,
  ) {
    const direction =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const next = dragMidiTimeline(
      timeline,
      handle,
      direction * (event.shiftKey ? 1 : MIDI_TIMELINE_MIN_Q),
    );
    if (!sameMidiTimeline(next, timeline)) {
      onChange(next, historyLabel(handle), "commit");
    }
  }

  function slider(
    handle: Exclude<MidiTimelineHandle, "loop">,
    className: string,
    style: { left: number } | undefined,
  ) {
    const valueQ = shown[handle];
    const name = HANDLE_NAMES[handle];
    const position = formatMusicalPosition(valueQ, ROLL_SIGNATURE);
    return (
      <span
        aria-label={name}
        aria-valuemax={viewQ}
        aria-valuemin={0}
        aria-valuenow={valueQ}
        aria-valuetext={position}
        className={className}
        data-ruler-handle={handle}
        onKeyDown={(event) => handleKeyDown(event, handle)}
        role="slider"
        style={style}
        tabIndex={0}
        title={`${name}: ${position}`}
      />
    );
  }

  return (
    <div
      className={`piano-roll__ruler${pan.isGrabbing ? " piano-roll__ruler--panning" : ""}`}
      data-piano-roll-ruler
      {...chainHandlers(pan.handlers, {
        onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) =>
          event.preventDefault(),
        onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) =>
          endDrag(event, true),
        onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) =>
          endDrag(event, false),
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) =>
          endDrag(event, true),
      })}
      style={{ width: at(viewQ) }}
    >
      {barStarts(viewQ).map((barQ) => (
        <span
          className="piano-roll__bar-number"
          key={barQ}
          style={{ left: at(barQ) }}
        >
          {barQ / 4 + 1}
        </span>
      ))}
      <span
        className="piano-roll__beyond-end"
        style={{ left: at(shown.length) }}
      />
      <div
        className={`piano-roll__loop${shown.loop ? "" : " piano-roll__loop--off"}`}
        data-ruler-handle="loop"
        style={{
          left: at(shown.loopStart),
          width: at(shown.loopEnd - shown.loopStart),
        }}
        title={`Loop ${shown.loop ? "on" : "off"}: drag to move`}
      >
        {slider("loopStart", "piano-roll__loop-edge", undefined)}
        {slider(
          "loopEnd",
          "piano-roll__loop-edge piano-roll__loop-edge--end",
          undefined,
        )}
      </div>
      {slider("start", "piano-roll__marker piano-roll__marker--start", {
        left: at(shown.start),
      })}
      {slider("length", "piano-roll__marker piano-roll__marker--end", {
        left: at(shown.length),
      })}
    </div>
  );
}
