import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { transportLabel } from "../format.ts";
import type { Camera } from "../ipc/types.ts";
import { Check, ChevronDown } from "./icons.tsx";

type Props = {
  cameras: Camera[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
};

/**
 * The camera dropdown. A native <select> can't show the transport line
 * under each name, so this is an ARIA listbox behind a pill button.
 */
export function CameraSelect({
  cameras,
  selectedId,
  disabled,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = cameras.find((camera) => camera.id === selectedId);

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
    if (disabled) setOpen(false);
  }, [disabled]);

  const show = () => {
    if (disabled || cameras.length === 0) return;
    const index = cameras.findIndex((camera) => camera.id === selectedId);
    setActive(Math.max(0, index));
    setOpen(true);
  };

  const choose = (index: number) => {
    const camera = cameras[index];
    setOpen(false);
    button.current?.focus();
    if (camera && camera.id !== selectedId) onSelect(camera.id);
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
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
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
        disabled={disabled || cameras.length === 0}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onButtonKey}
      >
        <span className={selected ? "select-value" : "select-placeholder"}>
          {selected?.name ??
            (cameras.length === 0 ? "No cameras found" : "Select a camera…")}
        </span>
        <ChevronDown className="select-chevron" />
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
