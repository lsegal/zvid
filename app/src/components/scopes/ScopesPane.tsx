import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type FrameSample,
  previewFrameAnalysis,
} from "../../fx-shaders/frame-analysis.ts";
import { drawScope } from "./scope-draw.ts";
import { SCOPE_KINDS, type ScopeKind } from "./scope-pixels.ts";
import { clampScopesHeight, MIN_SCOPES_HEIGHT_PX } from "./scopes-height.ts";
import "./scopes-pane.css";

// How far an arrow key moves the splitter, in CSS pixels.
const KEYBOARD_STEP_PX = 16;

// Whether the preview's Scopes panel is open, how tall it is (null while it
// shares the room evenly with the monitor) and which scope it shows. They
// live with the preview panel so it keeps them across the Timeline and
// Media tabs.
export function useScopesPane() {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [kind, setKind] = useState<ScopeKind>("waveform");
  const toggle = useCallback(() => setOpen((current) => !current), []);
  return { open, toggle, height, setHeight, kind, setKind };
}

export type ScopesPaneState = ReturnType<typeof useScopesPane>;

type ScopesPaneProps = {
  pane: ScopesPaneState;
  // The frame analysis id to show, or null to show `emptyMessage` instead.
  frameId: string | null;
  emptyMessage: string;
};

// Lumetri-style scopes of the preview's picture in a panel below the
// monitor, with a splitter above it that trades height between the two. It
// reads samples only while open.
export function ScopesPane({ pane, frameId, emptyMessage }: ScopesPaneProps) {
  const { height, setHeight, kind, setKind } = pane;
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plotRef = useRef<HTMLCanvasElement | null>(null);
  const sampleRef = useRef<FrameSample | null>(null);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const dragRef = useRef<{ startY: number; startPx: number } | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    plotRef.current ??= document.createElement("canvas");
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const deviceWidth = Math.round(width * scale);
    const deviceHeight = Math.round(height * scale);
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
    }
    drawScope(canvas, plotRef.current, kindRef.current, sampleRef.current, {
      width,
      height,
      scale,
    });
  }, []);

  // A new source starts blank rather than showing the last one's picture.
  useEffect(() => {
    sampleRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      delete canvas.dataset.sampled;
    }
    redraw();
    if (frameId === null) {
      return;
    }
    return previewFrameAnalysis.subscribe(frameId, (sample) => {
      sampleRef.current = sample;
      redraw();
      if (canvas) {
        canvas.dataset.sampled = "true";
      }
    });
  }, [frameId, redraw]);

  useEffect(() => {
    void kind;
    redraw();
  }, [kind, redraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [redraw]);

  // The room the panel shares with the monitor, which sits just above it.
  const room = () => {
    const root = rootRef.current;
    const monitor = root?.previousElementSibling;
    return (root?.offsetHeight ?? 0) + (monitor?.clientHeight ?? 0);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLHRElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startY: event.clientY,
      startPx: rootRef.current?.offsetHeight ?? 0,
    };
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLHRElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    setHeight(
      clampScopesHeight(drag.startPx + drag.startY - event.clientY, room()),
    );
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLHRElement>) => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLHRElement>) => {
    const step =
      event.key === "ArrowUp"
        ? KEYBOARD_STEP_PX
        : event.key === "ArrowDown"
          ? -KEYBOARD_STEP_PX
          : 0;
    if (!step) {
      return;
    }
    event.preventDefault();
    const current = rootRef.current?.offsetHeight ?? 0;
    setHeight(clampScopesHeight(current + step, room()));
  };

  return (
    <section
      ref={rootRef}
      className="scopes-pane"
      aria-label="Scopes"
      style={height === null ? undefined : { flex: "none", height }}
    >
      <hr
        className="scopes-pane__resize"
        aria-orientation="horizontal"
        aria-label="Resize scopes"
        aria-valuenow={height ?? undefined}
        aria-valuemin={MIN_SCOPES_HEIGHT_PX}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => setHeight(null)}
      />
      <div
        className="segmented-control scopes-pane__kinds"
        role="toolbar"
        aria-label="Scope"
      >
        {SCOPE_KINDS.map((scope) => (
          <button
            key={scope.kind}
            type="button"
            aria-pressed={kind === scope.kind}
            className={kind === scope.kind ? "is-active" : ""}
            title={scope.label}
            onClick={() => setKind(scope.kind)}
          >
            {scope.label}
          </button>
        ))}
      </div>
      <div className="scopes-pane__body">
        <canvas
          ref={canvasRef}
          className="scopes-pane__canvas"
          role="img"
          aria-label={
            SCOPE_KINDS.find((scope) => scope.kind === kind)?.label ?? kind
          }
          hidden={frameId === null}
        />
        {frameId === null ? (
          <p className="scopes-pane__empty">{emptyMessage}</p>
        ) : null}
      </div>
    </section>
  );
}
