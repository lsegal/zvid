import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import "./fader.css";

export type FaderTick = { value: number; label: string };

export type FaderProps = {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  accent: string;
  label: string;
  format?: (value: number) => string;
  /** Reads a typed value, such as "-inf" for the bottom of the range. */
  parse?: (text: string) => number | undefined;
  /** Scale marks beside the track, such as 0 dB. */
  ticks?: readonly FaderTick[];
  /** Fires continuously while the value changes. */
  onChange: (value: number) => void;
  /** Fires once when a drag, wheel, keyboard, reset, or typed edit ends. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
};

const TRACK_HEIGHT = 112;
const FINE_FACTOR = 10;
const WHEEL_COMMIT_DELAY_MS = 300;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stepDecimals(step: number) {
  const [, fraction = ""] = String(step).split(".");
  return fraction.length;
}

function quantize(value: number, min: number, max: number, step?: number) {
  const clamped = clamp(value, min, max);
  if (!step || step <= 0) {
    return Number(clamped.toPrecision(12));
  }
  const snapped = min + Math.round((clamped - min) / step) * step;
  return clamp(Number(snapped.toFixed(stepDecimals(step))), min, max);
}

const defaultFormat = (value: number) => String(value);

const defaultParse = (text: string) => {
  const parsed = Number.parseFloat(text.replace("−", "-"));
  return Number.isFinite(parsed) ? parsed : undefined;
};

// Typing "Mute", "-inf" or "−∞" goes to the bottom of the range.
const BOTTOM_WORDS = /^\s*(mute|[-−]?\s*(inf|∞))\s*$/i;

// A vertical fader: drag the track or its thumb, scroll, or use the arrow
// keys; double-click resets it, and clicking the readout types a value.
export function Fader({
  value,
  min,
  max,
  defaultValue,
  step,
  accent,
  label,
  format = defaultFormat,
  parse = defaultParse,
  ticks = [],
  onChange,
  onCommit,
  disabled = false,
}: FaderProps) {
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const range = max - min;
  const coarseStep = Math.max(step ?? 0, range / 78);
  const fineStep = step ?? range / 780;
  const pageStep = range / 13;

  // The live value used by gestures, so rapid events do not wait for the
  // parent to re-render with the new `value` prop.
  const currentRef = useRef(value);
  const pendingCommitRef = useRef(false);
  const wheelTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    lastY: number;
    raw: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  // Guards against the input's blur re-applying a value after Enter/Escape.
  const editingRef = useRef(false);
  const [draft, setDraft] = useState("");

  if (!dragRef.current && !pendingCommitRef.current) {
    currentRef.current = value;
  }

  const propsRef = useRef({ onChange, onCommit });
  propsRef.current = { onChange, onCommit };

  const emit = useCallback(
    (next: number) => {
      const quantized = quantize(next, min, max, step);
      if (quantized === currentRef.current) {
        return;
      }
      currentRef.current = quantized;
      pendingCommitRef.current = true;
      propsRef.current.onChange(quantized);
    },
    [min, max, step],
  );

  const flushCommit = useCallback(() => {
    if (wheelTimerRef.current !== null) {
      window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
    }
    if (!pendingCommitRef.current) {
      return;
    }
    pendingCommitRef.current = false;
    propsRef.current.onCommit?.(currentRef.current);
  }, []);

  const setAndCommit = useCallback(
    (next: number) => {
      flushCommit();
      emit(next);
      flushCommit();
    },
    [emit, flushCommit],
  );

  useEffect(
    () => () => {
      if (wheelTimerRef.current !== null) {
        window.clearTimeout(wheelTimerRef.current);
      }
    },
    [],
  );

  // React registers wheel listeners as passive, so preventDefault needs a
  // native listener to stop the surrounding panel from scrolling.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || disabled) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (delta === 0) {
        return;
      }
      event.preventDefault();
      const increment = event.shiftKey ? fineStep : coarseStep;
      emit(currentRef.current + (delta < 0 ? increment : -increment));
      if (wheelTimerRef.current !== null) {
        window.clearTimeout(wheelTimerRef.current);
      }
      wheelTimerRef.current = window.setTimeout(
        flushCommit,
        WHEEL_COMMIT_DELAY_MS,
      );
    };
    track.addEventListener("wheel", handleWheel, { passive: false });
    return () => track.removeEventListener("wheel", handleWheel);
  }, [disabled, coarseStep, fineStep, emit, flushCommit]);

  // The value at a pointer's height on the track.
  const valueAt = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) {
      return currentRef.current;
    }
    return min + clamp((rect.bottom - clientY) / rect.height, 0, 1) * range;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    flushCommit();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    // A press on the track jumps there; Shift keeps the value for a fine
    // drag from it.
    const raw = event.shiftKey ? currentRef.current : valueAt(event.clientY);
    dragRef.current = { pointerId: event.pointerId, lastY: event.clientY, raw };
    setDragging(true);
    emit(raw);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const height = trackRef.current?.getBoundingClientRect().height || 1;
    const pixels = event.shiftKey ? height * FINE_FACTOR : height;
    drag.raw = clamp(
      drag.raw + ((drag.lastY - event.clientY) / pixels) * range,
      min,
      max,
    );
    drag.lastY = event.clientY;
    emit(drag.raw);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    flushCommit();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const increment = event.shiftKey ? fineStep : coarseStep;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = currentRef.current + increment;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        next = currentRef.current - increment;
        break;
      case "PageUp":
        next = currentRef.current + pageStep;
        break;
      case "PageDown":
        next = currentRef.current - pageStep;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    emit(next);
  };

  const openEditor = () => {
    if (disabled) {
      return;
    }
    flushCommit();
    setDraft(format(currentRef.current).replace(/\s*dB$/i, ""));
    editingRef.current = true;
    setEditing(true);
  };

  const closeEditor = (apply: boolean) => {
    if (!editingRef.current) {
      return;
    }
    editingRef.current = false;
    setEditing(false);
    const parsed = BOTTOM_WORDS.test(draft) ? min : parse(draft);
    if (apply && parsed !== undefined) {
      setAndCommit(parsed);
    }
    trackRef.current?.focus();
  };

  const position = (at: number) =>
    range > 0 ? (clamp(at, min, max) - min) / range : 0;
  const valueText = format(value);

  return (
    <div
      className={[
        "fader",
        dragging ? "fader--dragging" : "",
        disabled ? "fader--disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--fader-accent": accent,
          "--fader-height": `${TRACK_HEIGHT}px`,
          "--fader-position": position(value),
        } as CSSProperties
      }
    >
      <span className="fader__label" id={labelId} title={label}>
        {label}
      </span>
      <div className="fader__body">
        <div
          ref={trackRef}
          className="fader__track"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={labelId}
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={valueText}
          aria-disabled={disabled || undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={handleKeyDown}
          onKeyUp={flushCommit}
          onBlur={flushCommit}
          onDoubleClick={() => {
            if (!disabled) {
              setAndCommit(defaultValue);
            }
          }}
        >
          <span className="fader__fill" aria-hidden="true" />
          <span className="fader__thumb" aria-hidden="true" />
        </div>
        <span className="fader__scale" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              className="fader__tick"
              key={tick.label}
              style={
                { "--tick-position": position(tick.value) } as CSSProperties
              }
            >
              {tick.label}
            </span>
          ))}
        </span>
      </div>
      {editing ? (
        <input
          className="fader__input"
          type="text"
          inputMode="decimal"
          aria-label={`${label} value`}
          value={draft}
          // biome-ignore lint/a11y/noAutofocus: the editor opens on an explicit request to type a value
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => closeEditor(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              closeEditor(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeEditor(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="fader__value-text"
          disabled={disabled}
          title="Click to type a value"
          aria-label={`${label}: ${valueText}. Edit value`}
          onClick={openEditor}
        >
          {valueText}
        </button>
      )}
    </div>
  );
}
