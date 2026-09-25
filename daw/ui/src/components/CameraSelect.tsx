import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { transportLabel } from "../format.ts";
import type { Camera } from "../ipc/types.ts";
import { Check, ChevronDown } from "./icons.tsx";
import { Spinner } from "./Status.tsx";
import { typeAheadMatch } from "./type-ahead.ts";

type Props = {
  cameras: Camera[];
  selectedId: string | null;
  /** While capturing; the trigger stays focusable. */
  disabled: boolean;
  /** While devices are being enumerated. */
  busy: boolean;
  onSelect: (id: string) => void;
};

/** How long typed characters accumulate into one type-ahead search. */
const TYPE_AHEAD_MS = 600;

/**
 * The camera dropdown. A native <select> can't show the transport line
 * under each name, so this is an ARIA listbox behind a pill button.
 */
export function CameraSelect({
  cameras,
  selectedId,
  disabled,
  busy,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const selected = cameras.find((camera) => camera.id === selectedId);
  const unavailable = disabled || busy || cameras.length === 0;

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !list.current?.contains(target) &&
        !button.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  useEffect(() => {
    if (open) {
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [open, active, listId]);

  const show = () => {
    if (unavailable) return;
    const index = cameras.findIndex((camera) => camera.id === selectedId);
    setActive(Math.max(0, index));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const choose = (index: number) => {
    const camera = cameras[index];
    close();
    if (camera && camera.id !== selectedId) onSelect(camera.id);
  };

  const typeAhead = (key: string) => {
    const now = performance.now();
    const text =
      now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + key : key;
    typed.current = { text, at: now };
    // A repeated first letter cycles; a longer query refines in place.
    const from = text.length > 1 ? active : active + 1;
    const match = typeAheadMatch(cameras, text, from);
    if (match >= 0) setActive(match);
  };

  const onListKey = (event: KeyboardEvent) => {
    const last = cameras.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(last, active + 1),
      ArrowUp: Math.max(0, active - 1),
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      typeAhead(event.key);
    }
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show();
    }
  };

  return (
    <div className="camera-select">
      <button
        ref={button}
        type="button"
        className="select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={selected ? `Camera: ${selected.name}` : "Select a camera"}
        aria-disabled={unavailable || undefined}
        aria-busy={busy || undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
      >
        <span className={selected ? "select-value" : "select-placeholder"}>
          {selected?.name ??
            (cameras.length === 0 ? "No cameras found" : "Select a camera…")}
        </span>
        {busy ? <Spinner /> : <ChevronDown className="select-chevron" />}
      </button>
      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="select-menu"
          aria-label="Cameras"
          aria-activedescendant={`${listId}-${active}`}
          onKeyDown={onListKey}
        >
          {cameras.map((camera, index) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys for its options
            <div
              key={camera.id}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={camera.id === selectedId}
              className={`select-option${index === active ? " is-active" : ""}`}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span className="option-text">
                <span className="option-name">{camera.name}</span>
                <span className="option-detail">
                  {transportLabel(camera.transport)}
                </span>
              </span>
              {camera.id === selectedId && <Check className="option-check" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
