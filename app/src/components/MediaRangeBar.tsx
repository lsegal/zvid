import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { formatMediaTime } from "../app/media-preview.ts";
import { isEditableEventTarget } from "../app/util.ts";
import type { MediaItem } from "../media";
import {
  effectiveMediaRange,
  type MediaRange,
  type MediaRangePoint,
  mediaRangeFrameRate,
  mediaRangeOf,
  setMediaRangePoint,
} from "../media-range.ts";
import type { TimeValueFormat } from "../time-value.ts";
import "./media-range.css";

export type MediaRangeActions = {
  setPoint: (mediaId: string, point: MediaRangePoint, seconds: number) => void;
  clear: (mediaId: string) => void;
};

const POINT_LABELS = { in: "In", out: "Out" } as const;

// Where the I and O keys apply: the Media tab and the Media drawer, so they
// never reach the timeline.
const MEDIA_RANGE_KEY_SCOPE = ".media-preview, .media-drawer";

type MediaRangeBarProps = {
  media: MediaItem;
  // The player's duration, which places the markers along the scrub bar.
  duration: number;
  projectFps: number;
  onSetPoint: (point: MediaRangePoint, seconds: number) => void;
  onSeek: (seconds: number) => void;
  // The scrub bar the markers sit over.
  children: ReactNode;
};

type Drag = { point: MediaRangePoint; pointerId: number; seconds: number };

// The Media tab's scrub bar with the media's In and Out markers on it, and
// the parts of the media outside them dimmed. Dragging a marker previews the
// range and seeks the media to it; letting go sets the point.
export function MediaRangeBar({
  media,
  duration,
  projectFps,
  onSetPoint,
  onSeek,
  children,
}: MediaRangeBarProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<MediaRange | null>(null);
  const range = preview ?? mediaRangeOf(media);
  const shown = range ?? effectiveMediaRange(media);
  const percent = (seconds: number) =>
    duration > 0
      ? `${Math.min(1, Math.max(0, seconds / duration)) * 100}%`
      : "0%";

  function pointerSeconds(event: ReactPointerEvent) {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return 0;
    }
    const fraction = (event.clientX - rect.left) / rect.width;
    return Math.min(1, Math.max(0, fraction)) * duration;
  }

  function applyDrag(drag: Drag, event: ReactPointerEvent) {
    const moved = setMediaRangePoint(
      media,
      drag.point,
      pointerSeconds(event),
      projectFps,
    );
    const next = mediaRangeOf(moved);
    if (!next) {
      return;
    }
    drag.seconds = drag.point === "in" ? next.inSeconds : next.outSeconds;
    setPreview(next);
    onSeek(drag.seconds);
  }

  function startDrag(point: MediaRangePoint, event: ReactPointerEvent) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const drag = { point, pointerId: event.pointerId, seconds: 0 };
    dragRef.current = drag;
    applyDrag(drag, event);
  }

  function onPointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      applyDrag(drag, event);
    }
  }

  function endDrag(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setPreview(null);
    if (event.type === "pointerup") {
      onSetPoint(drag.point, drag.seconds);
    }
  }

  // Arrow keys move a focused marker a frame, or ten with Shift.
  function onMarkerKeyDown(
    point: MediaRangePoint,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) {
      return;
    }
    event.preventDefault();
    // The timeline's arrow-key shortcuts must not also move its playhead.
    event.stopPropagation();
    const frame = 1 / mediaRangeFrameRate(media, projectFps);
    const from = point === "in" ? shown.inSeconds : shown.outSeconds;
    onSetPoint(point, from + direction * frame * (event.shiftKey ? 10 : 1));
  }

  const marker = (point: MediaRangePoint) => {
    const seconds = point === "in" ? shown.inSeconds : shown.outSeconds;
    const label = POINT_LABELS[point];
    return (
      <div
        aria-label={`Media ${label} point`}
        aria-valuemax={duration}
        aria-valuemin={0}
        aria-valuenow={seconds}
        className={`media-range__marker media-range__marker--${point}`}
        data-media-range-marker={point}
        onKeyDown={(event) => onMarkerKeyDown(point, event)}
        onLostPointerCapture={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={(event) => startDrag(point, event)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        role="slider"
        style={{ left: percent(seconds) }}
        tabIndex={0}
        title={`Drag to set the ${label} point`}
      >
        <span className="media-range__flag">{label}</span>
      </div>
    );
  };

  return (
    <div
      ref={barRef}
      className="media-range"
      data-has-range={range ? "" : undefined}
    >
      {children}
      {range ? (
        <>
          <div
            className="media-range__dim"
            data-media-range-dim="before"
            style={{ left: 0, width: percent(range.inSeconds) }}
          />
          <div
            className="media-range__dim"
            data-media-range-dim="after"
            style={{ left: percent(range.outSeconds), right: 0 }}
          />
        </>
      ) : null}
      {marker("in")}
      {marker("out")}
    </div>
  );
}

type MediaRangeControlsProps = {
  media: MediaItem;
  currentTime: number;
  timeFormat: TimeValueFormat;
  onSetPoint: (point: MediaRangePoint, seconds: number) => void;
  onClear: () => void;
};

// The Set In / Set Out / Clear buttons and the In, Out and range duration
// readout under the Media tab's scrub bar. I and O set the points at the
// media playhead while the Media tab or drawer has focus.
export function MediaRangeControls({
  media,
  currentTime,
  timeFormat,
  onSetPoint,
  onClear,
}: MediaRangeControlsProps) {
  const range = mediaRangeOf(media);
  const shown = range ?? effectiveMediaRange(media);
  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;
  const setPointRef = useRef(onSetPoint);
  setPointRef.current = onSetPoint;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if (
        (key !== "i" && key !== "o") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        // The scrub bar is an input, but not one that takes text.
        (isEditableEventTarget(event.target) &&
          !(
            event.target instanceof HTMLInputElement &&
            event.target.type === "range"
          )) ||
        !(document.activeElement instanceof Element) ||
        !document.activeElement.closest(MEDIA_RANGE_KEY_SCOPE)
      ) {
        return;
      }
      event.preventDefault();
      setPointRef.current(key === "i" ? "in" : "out", timeRef.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="media-range-controls">
      <button
        type="button"
        className="media-range-controls__button"
        title="Set In point (I)"
        onClick={() => onSetPoint("in", currentTime)}
      >
        Set In
      </button>
      <button
        type="button"
        className="media-range-controls__button"
        title="Set Out point (O)"
        onClick={() => onSetPoint("out", currentTime)}
      >
        Set Out
      </button>
      <button
        type="button"
        className="media-range-controls__button"
        title="Clear In and Out points"
        disabled={!range}
        onClick={onClear}
      >
        Clear
      </button>
      <span
        className="media-range-controls__readout"
        data-testid="media-range-readout"
        data-has-range={range ? "" : undefined}
      >
        <span>In {formatMediaTime(shown.inSeconds, timeFormat)}</span>
        <span>Out {formatMediaTime(shown.outSeconds, timeFormat)}</span>
        <span>
          Duration{" "}
          {formatMediaTime(shown.outSeconds - shown.inSeconds, timeFormat)}
        </span>
      </span>
    </div>
  );
}
