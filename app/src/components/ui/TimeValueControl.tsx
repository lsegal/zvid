import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useId,
  useRef,
  useState,
} from "react";
import {
  clampTimeValue,
  formatTimeValue,
  moveTimeValueDrag,
  resolveTimeValueEdit,
  startTimeValueDrag,
  type TimeValueDrag,
  type TimeValueEditEnd,
  type TimeValueFormat,
  type TimeValueKind,
  timeValueDragChanged,
  timeValueForKey,
} from "../../time-value.ts";
import "./time-value-control.css";

export type TimeValueChangeMeta = { commit: boolean };

export type TimeValueControlProps = TimeValueFormat & {
  /** The value in quarter notes. */
  value: number;
  min: number;
  max: number;
  kind: TimeValueKind;
  label: string;
  /**
   * Fires with `commit: false` while a drag or held arrow key changes the
   * value, and once with `commit: true` when the gesture or typed edit ends,
   * so the caller can record a single undo step.
   */
  onChange: (value: number, meta: TimeValueChangeMeta) => void;
  accent?: string;
  disabled?: boolean;
  className?: string;
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// A single printable character starts a typed edit from the field.
function isTypedCharacter(event: ReactKeyboardEvent) {
  return (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key !== " "
  );
}

export function TimeValueControl({
  value,
  min,
  max,
  kind,
  label,
  onChange,
  accent,
  disabled = false,
  className,
  ...timeFormat
}: TimeValueControlProps) {
  const format: TimeValueFormat = {
    timelineMode: timeFormat.timelineMode,
    bpm: timeFormat.bpm,
    signature: timeFormat.signature,
    fps: timeFormat.fps,
  };
  const range = { min, max };
  const labelId = useId();
  const fieldRef = useRef<HTMLDivElement>(null);
  // The live value used by gestures, so rapid events do not wait for the
  // parent to re-render with the new `value` prop.
  const currentRef = useRef(value);
  const pendingCommitRef = useRef(false);
  const dragRef = useRef<TimeValueDrag | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  // Guards against the input's blur re-applying a value after Enter/Escape.
  const editingRef = useRef(false);
  const [draft, setDraft] = useState("");

  if (!dragRef.current && !pendingCommitRef.current) {
    currentRef.current = value;
  }

  const emitLive = (next: number) => {
    if (next === currentRef.current) {
      return;
    }
    currentRef.current = next;
    pendingCommitRef.current = true;
    onChange(next, { commit: false });
  };

  const flushCommit = () => {
    if (!pendingCommitRef.current) {
      return;
    }
    pendingCommitRef.current = false;
    onChange(currentRef.current, { commit: true });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled || editing || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    flushCommit();
    fieldRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = startTimeValueDrag(
      event.pointerId,
      currentRef.current,
      event.clientY,
    );
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const next = moveTimeValueDrag(
      drag,
      event.clientY,
      event.shiftKey,
      format,
      range,
    );
    dragRef.current = next;
    emitLive(next.value);
  };

  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    if (timeValueDragChanged(drag)) {
      flushCommit();
    } else {
      pendingCommitRef.current = false;
    }
  };

  const openEditor = (initialDraft?: string) => {
    if (disabled || editingRef.current) {
      return;
    }
    flushCommit();
    setDraft(initialDraft ?? formatTimeValue(currentRef.current, kind, format));
    editingRef.current = true;
    setEditing(true);
  };

  const closeEditor = (end: TimeValueEditEnd) => {
    if (!editingRef.current) {
      return;
    }
    editingRef.current = false;
    setEditing(false);
    const result = resolveTimeValueEdit(end, draft, kind, format, range);
    if (result.kind === "commit") {
      currentRef.current = result.value;
      pendingCommitRef.current = false;
      onChange(result.value, { commit: true });
    }
    if (end !== "blur") {
      fieldRef.current?.focus();
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || editing) {
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      openEditor();
      return;
    }
    if (isTypedCharacter(event)) {
      event.preventDefault();
      openEditor(event.key);
      return;
    }
    const next = timeValueForKey(
      event.key,
      event.shiftKey,
      currentRef.current,
      format,
      range,
    );
    if (next === null) {
      return;
    }
    event.preventDefault();
    emitLive(next);
  };

  const shown = clampTimeValue(value, range);
  const valueText = formatTimeValue(shown, kind, format);

  return (
    <div
      className={cn(
        "time-value",
        dragging && "time-value--dragging",
        editing && "time-value--editing",
        disabled && "time-value--disabled",
        className,
      )}
      style={
        accent ? ({ "--time-value-accent": accent } as CSSProperties) : {}
      }
    >
      <span className="time-value__label" id={labelId} title={label}>
        {label}
      </span>
      <div
        ref={fieldRef}
        className="time-value__field"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={labelId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        onKeyDown={handleKeyDown}
        onKeyUp={flushCommit}
        onBlur={flushCommit}
      >
        {editing ? (
          <input
            className="time-value__input"
            type="text"
            spellCheck={false}
            aria-label={`${label} value`}
            value={draft}
            // biome-ignore lint/a11y/noAutofocus: the editor opens on an explicit request to type a value
            autoFocus
            onFocus={(event) => {
              // A draft seeded by a typed character keeps the caret after it.
              if (draft === valueText) {
                event.currentTarget.select();
              }
            }}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={() => closeEditor("blur")}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                closeEditor("enter");
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeEditor("escape");
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="time-value__text"
            tabIndex={-1}
            disabled={disabled}
            title="Click or press Enter to type a value"
            aria-label={`${label}: ${valueText}. Edit value`}
            onClick={() => openEditor()}
          >
            {valueText}
          </button>
        )}
        <span
          className="time-value__handle"
          aria-hidden="true"
          title="Drag up or down to change (Shift for larger steps)"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
            <path d="M4 1 L7.5 5 H0.5 Z" />
            <path d="M4 13 L7.5 9 H0.5 Z" />
          </svg>
        </span>
      </div>
    </div>
  );
}
