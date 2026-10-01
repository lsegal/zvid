// Pure logic behind TimeValueControl: a time value held in quarter notes,
// shown and typed in the current timeline format (musical bar.beat.sixteenth
// or mm:ss:ff timecode), stepped by drag or arrow keys, and clamped to a
// range. The component wires DOM events to these functions.

import type { TimelineMode } from "./app/types.ts";
import type { MeterSignature } from "./timeline-format.ts";

// A position is a point on the timeline (musical values count from 1, like
// the ruler); a duration is a length (musical values count from 0).
export type TimeValueKind = "position" | "duration";

export type TimeValueFormat = {
  timelineMode: TimelineMode;
  bpm: number;
  signature: MeterSignature;
  fps: number;
};

export type TimeValueRange = { min: number; max: number };

// Pixels of vertical pointer travel per step while dragging the handle.
export const TIME_VALUE_DRAG_PIXELS_PER_STEP = 4;

// Absorbs float error so a value a hair under a tick reads as the tick.
const EPSILON = 1e-6;

function beatUnit(signature: MeterSignature) {
  return 4 / Math.max(1, signature.denominator);
}

function barLength(signature: MeterSignature) {
  return Math.max(1, signature.numerator) * beatUnit(signature);
}

function frameRate(format: TimeValueFormat) {
  return Math.max(1, format.fps);
}

function secondsPerQuarter(format: TimeValueFormat) {
  return 60 / Math.max(1e-9, format.bpm);
}

// Trims floating-point noise from accumulated steps.
function clean(value: number) {
  return Number(value.toPrecision(12));
}

const pad2 = (value: number) => value.toString().padStart(2, "0");

export function clampTimeValue(value: number, { min, max }: TimeValueRange) {
  return Math.min(Math.max(min, max), Math.max(min, value));
}

/**
 * The size of one step in quarter notes: a sixteenth of a beat (musical) or
 * a frame (timecode); coarse steps are a beat or a second.
 */
export function timeValueStep(format: TimeValueFormat, coarse = false) {
  if (format.timelineMode === "musical") {
    const beat = beatUnit(format.signature);
    return coarse ? beat : beat / 4;
  }
  const seconds = coarse ? 1 : 1 / frameRate(format);
  return seconds / secondsPerQuarter(format);
}

/** `quarters` in the current timeline format. */
export function formatTimeValue(
  quarters: number,
  kind: TimeValueKind,
  format: TimeValueFormat,
) {
  const safe = Math.max(0, quarters);
  if (format.timelineMode === "timecode") {
    const fps = frameRate(format);
    const seconds = safe * secondsPerQuarter(format);
    let totalSeconds = Math.floor(seconds + EPSILON);
    let frames = Math.floor((seconds - totalSeconds) * fps + EPSILON);
    if (frames < 0) {
      frames = 0;
    } else if (frames >= Math.ceil(fps)) {
      totalSeconds += 1;
      frames = 0;
    }
    return `${pad2(Math.floor(totalSeconds / 60))}:${pad2(
      totalSeconds % 60,
    )}:${pad2(frames)}`;
  }
  const tick = beatUnit(format.signature) / 4;
  const ticksPerBar = Math.max(1, format.signature.numerator) * 4;
  const totalTicks = Math.floor(safe / tick + EPSILON);
  const bars = Math.floor(totalTicks / ticksPerBar);
  const beats = Math.floor((totalTicks % ticksPerBar) / 4);
  const sixteenths = totalTicks % 4;
  const origin = kind === "position" ? 1 : 0;
  return `${bars + origin}.${beats + origin}.${sixteenths + origin}`;
}

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

// `mm:ss:ff`, `hh:mm:ss:ff`, `mm:ss` (seconds may be fractional), or bare
// seconds. Fields may overflow (`0:90` is 1:30).
function parseTimecodeSeconds(text: string, fps: number) {
  if (DECIMAL.test(text)) {
    return Number(text);
  }
  const parts = text.split(":").map((part) => part.trim());
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (!WHOLE.test(minutes) || !DECIMAL.test(seconds)) {
      return null;
    }
    return Number(minutes) * 60 + Number(seconds);
  }
  if ((parts.length !== 3 && parts.length !== 4) || !parts.every(isWhole)) {
    return null;
  }
  const [frames, seconds, minutes, hours = 0] = parts.map(Number).reverse();
  return hours * 3600 + minutes * 60 + seconds + frames / fps;
}

function isWhole(part: string) {
  return WHOLE.test(part);
}

// `bar.beat.sixteenth` with trailing fields optional (`3.2` is bar 3 beat
// 2), or bare bars. Fields may overflow into the next unit.
function parseMusicalQuarters(
  text: string,
  kind: TimeValueKind,
  signature: MeterSignature,
) {
  const parts = text.split(".").map((part) => part.trim());
  if (parts.length > 3 || !parts.every(isWhole)) {
    return null;
  }
  const origin = kind === "position" ? 1 : 0;
  const [bars, beats = origin, sixteenths = origin] = parts.map(Number);
  if (bars < origin || beats < origin || sixteenths < origin) {
    return null;
  }
  const beat = beatUnit(signature);
  return (
    (bars - origin) * barLength(signature) +
    (beats - origin) * beat +
    (sixteenths - origin) * (beat / 4)
  );
}

/**
 * Parses typed text into quarter notes, or null when it is not a time.
 * Musical mode also accepts timecode written with colons (`1:05`).
 */
export function parseTimeValue(
  text: string,
  kind: TimeValueKind,
  format: TimeValueFormat,
): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  if (format.timelineMode === "musical" && !trimmed.includes(":")) {
    return parseMusicalQuarters(trimmed, kind, format.signature);
  }
  const seconds = parseTimecodeSeconds(trimmed, frameRate(format));
  if (seconds === null || !Number.isFinite(seconds)) {
    return null;
  }
  return clean(seconds / secondsPerQuarter(format));
}

/**
 * Moves `value` by `steps` steps (negative steps move down), landing on the
 * step grid so an off-grid value snaps to the next grid line in that
 * direction, then clamps to the range.
 */
export function stepTimeValue(
  value: number,
  steps: number,
  format: TimeValueFormat,
  range: TimeValueRange,
  coarse = false,
) {
  if (steps === 0) {
    return clampTimeValue(value, range);
  }
  const step = timeValueStep(format, coarse);
  const position = value / step;
  const base =
    steps > 0
      ? Math.floor(position + EPSILON)
      : Math.ceil(position - EPSILON);
  return clampTimeValue(clean((base + steps) * step), range);
}

/** The value an arrow key steps to, or null for any other key. */
export function timeValueForKey(
  key: string,
  coarse: boolean,
  value: number,
  format: TimeValueFormat,
  range: TimeValueRange,
) {
  if (key === "ArrowUp") {
    return stepTimeValue(value, 1, format, range, coarse);
  }
  if (key === "ArrowDown") {
    return stepTimeValue(value, -1, format, range, coarse);
  }
  return null;
}

export type TimeValueEditEnd = "enter" | "blur" | "escape";

/**
 * What closing the text editor does: Enter and blur commit a valid draft,
 * clamped; Escape, or a draft that does not parse, reverts.
 */
export function resolveTimeValueEdit(
  end: TimeValueEditEnd,
  draft: string,
  kind: TimeValueKind,
  format: TimeValueFormat,
  range: TimeValueRange,
): { kind: "commit"; value: number } | { kind: "revert" } {
  if (end === "escape") {
    return { kind: "revert" };
  }
  const parsed = parseTimeValue(draft, kind, format);
  if (parsed === null) {
    return { kind: "revert" };
  }
  return { kind: "commit", value: clampTimeValue(parsed, range) };
}

export type TimeValueDrag = {
  pointerId: number;
  startValue: number;
  value: number;
  lastY: number;
  // Pointer travel not yet turned into a whole step.
  carryPx: number;
};

export function startTimeValueDrag(
  pointerId: number,
  value: number,
  clientY: number,
): TimeValueDrag {
  return { pointerId, startValue: value, value, lastY: clientY, carryPx: 0 };
}

/**
 * Advances a drag to `clientY`: moving up increases the value and moving
 * down decreases it, one step per few pixels, clamped to the range.
 */
export function moveTimeValueDrag(
  drag: TimeValueDrag,
  clientY: number,
  coarse: boolean,
  format: TimeValueFormat,
  range: TimeValueRange,
): TimeValueDrag {
  const carryPx = drag.carryPx + (drag.lastY - clientY);
  const steps = Math.trunc(carryPx / TIME_VALUE_DRAG_PIXELS_PER_STEP);
  return {
    ...drag,
    lastY: clientY,
    carryPx: carryPx - steps * TIME_VALUE_DRAG_PIXELS_PER_STEP,
    value:
      steps === 0
        ? drag.value
        : stepTimeValue(drag.value, steps, format, range, coarse),
  };
}

/** Whether releasing the drag should commit, i.e. the value changed. */
export function timeValueDragChanged(drag: TimeValueDrag) {
  return drag.value !== drag.startValue;
}
