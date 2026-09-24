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
import "./knob.css";

export type KnobProps = {
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  /** Draw the value arc from the center of the range (e.g. hue shift). */
  bipolar?: boolean;
  accent: string;
  label: string;
  format?: (value: number) => string;
  /** Fires continuously while the value changes. */
  onChange: (value: number) => void;
  /** Fires once when a drag, wheel, keyboard, reset, or typed edit ends. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
  className?: string;
};

const SIZE = 44;
const CENTER = SIZE / 2;
const RADIUS = 17;
const SWEEP_DEGREES = 270;
const START_ANGLE = -SWEEP_DEGREES / 2;
const DRAG_PIXELS = 200;
const FINE_FACTOR = 10;
const WHEEL_COMMIT_DELAY_MS = 300;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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
    // Trim floating-point noise from accumulated drag deltas.
    return Number(clamped.toPrecision(12));
  }
  const snapped = min + Math.round((clamped - min) / step) * step;
  return clamp(Number(snapped.toFixed(stepDecimals(step))), min, max);
}

// Angles are measured in degrees clockwise from 12 o'clock.
function polar(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.sin(radians),
    y: CENTER - radius * Math.cos(radians),
  };
}

function arcPath(fromAngle: number, toAngle: number, radius: number) {
  const start = polar(fromAngle, radius);
  const end = polar(toAngle, radius);
  const largeArc = toAngle - fromAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

const defaultFormat = (value: number) => String(value);

export function Knob({
  value,
  min,
  max,
  defaultValue,
  step,
  bipolar = false,
  accent,
  label,
  format = defaultFormat,
  onChange,
  onCommit,
  disabled = false,
  className,
}: KnobProps) {
  const labelId = useId();
  const dialRef = useRef<HTMLDivElement>(null);
  const range = max - min;
  const coarseStep = step ?? range / 100;
  const fineStep = step ?? range / 1000;
  const pageStep = step
    ? Math.max(step, Math.round(range / 10 / step) * step)
    : range / 10;

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
    const dial = dialRef.current;
    if (!dial || disabled) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      // Shift+wheel is reported as horizontal scrolling on some platforms.
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
    dial.addEventListener("wheel", handleWheel, { passive: false });
    return () => dial.removeEventListener("wheel", handleWheel);
  }, [disabled, coarseStep, fineStep, emit, flushCommit]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    flushCommit();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      lastY: event.clientY,
      raw: currentRef.current,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const pixels = event.shiftKey ? DRAG_PIXELS * FINE_FACTOR : DRAG_PIXELS;
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
    setDraft(String(currentRef.current));
    editingRef.current = true;
    setEditing(true);
  };

  const closeEditor = (apply: boolean) => {
    if (!editingRef.current) {
      return;
    }
    editingRef.current = false;
    setEditing(false);
    const parsed = Number.parseFloat(draft);
    if (apply && Number.isFinite(parsed)) {
      setAndCommit(parsed);
    }
    dialRef.current?.focus();
  };

  const norm = range > 0 ? (clamp(value, min, max) - min) / range : 0;
  const valueAngle = START_ANGLE + norm * SWEEP_DEGREES;
  const originAngle = bipolar ? 0 : START_ANGLE;
  const arcFrom = Math.min(originAngle, valueAngle);
  const arcTo = Math.max(originAngle, valueAngle);
  const pointerInner = polar(valueAngle, 5);
  const pointerOuter = polar(valueAngle, RADIUS - 5);
  const valueText = format(value);

  return (
    <div
      className={cn(
        "knob",
        dragging && "knob--dragging",
        disabled && "knob--disabled",
        className,
      )}
      style={{ "--knob-accent": accent } as CSSProperties}
    >
      <span className="knob__label" id={labelId} title={label}>
        {label}
      </span>
      <div
        ref={dialRef}
        className="knob__dial"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={labelId}
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
        <svg
          className="knob__svg"
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden="true"
        >
          <path
            className="knob__track"
            d={arcPath(START_ANGLE, START_ANGLE + SWEEP_DEGREES, RADIUS)}
          />
          {arcTo - arcFrom > 0.01 ? (
            <path className="knob__value" d={arcPath(arcFrom, arcTo, RADIUS)} />
          ) : null}
          <circle className="knob__body" cx={CENTER} cy={CENTER} r={11.5} />
          <line
            className="knob__pointer"
            x1={pointerInner.x}
            y1={pointerInner.y}
            x2={pointerOuter.x}
            y2={pointerOuter.y}
          />
        </svg>
      </div>
      {editing ? (
        <input
          className="knob__input"
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
          className="knob__value-text"
          disabled={disabled}
          title="Double-click or press Enter to type a value"
          aria-label={`${label}: ${valueText}. Edit value`}
          onDoubleClick={openEditor}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              openEditor();
            }
          }}
        >
          {valueText}
        </button>
      )}
    </div>
  );
}
