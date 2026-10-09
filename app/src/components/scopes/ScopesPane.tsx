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
import "./scopes-pane.css";

// The pane's height as a share of the picture it covers: half to start, at
// most nine tenths, and at least MIN_HEIGHT CSS pixels.
export const DEFAULT_SCOPES_HEIGHT = 0.5;
export const MAX_SCOPES_HEIGHT = 0.9;
export const MIN_SCOPES_HEIGHT_PX = 96;
// How far an arrow key moves the pane's top edge.
const KEYBOARD_STEP = 0.05;

// The share of a `containerHeight`-tall picture a pane `heightPx` tall
// covers, kept between the pane's minimum and maximum heights.
export function clampScopesHeight(heightPx: number, containerHeight: number) {
  if (containerHeight <= 0) {
    return DEFAULT_SCOPES_HEIGHT;
  }
  const most = containerHeight * MAX_SCOPES_HEIGHT;
  const least = Math.min(MIN_SCOPES_HEIGHT_PX, most);
  return Math.min(most, Math.max(least, heightPx)) / containerHeight;
}

// Whether the preview's Scopes pane is open, how tall it is and which scope
// it shows. They live with the preview panel so the pane keeps them when it
// moves between the Timeline and Media tabs.
export function useScopesPane() {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(DEFAULT_SCOPES_HEIGHT);
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

// Lumetri-style scopes of the preview's picture over the bottom of it, with
// a top edge that drags to resize it. It reads samples only while open.
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

  const containerHeight = () =>
    rootRef.current?.parentElement?.clientHeight ?? 0;

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
      clampScopesHeight(
        drag.startPx + drag.startY - event.clientY,
        containerHeight(),
      ),
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
        ? KEYBOARD_STEP
        : event.key === "ArrowDown"
          ? -KEYBOARD_STEP
          : 0;
    if (!step) {
      return;
    }
    event.preventDefault();
    const container = containerHeight();
    setHeight(clampScopesHeight((height + step) * container, container));
  };

  return (
    <section
      ref={rootRef}
      className="scopes-pane"
      aria-label="Scopes"
      style={{ height: `${height * 100}%` }}
    >
      <hr
        className="scopes-pane__resize"
        aria-orientation="horizontal"
        aria-label="Resize scopes"
        aria-valuenow={Math.round(height * 100)}
        aria-valuemin={0}
        aria-valuemax={Math.round(MAX_SCOPES_HEIGHT * 100)}
        tabIndex={0}
        title="Drag to resize"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleKeyDown}
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
