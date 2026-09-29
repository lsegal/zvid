import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Point } from "../composition-transform.ts";
import {
  canvasToScreen,
  constrainDragDelta,
  hitTestLayers,
  isPointOnLayer,
  offsetTransformPosition,
  type PreviewLayer,
  resolveNudgeDelta,
  resolveVideoRect,
  type Size,
  screenToCanvas,
} from "../preview-edit.ts";
import "./preview-transform-overlay.css";

export type PreviewLayerMove = {
  laneId: string;
  position: Point;
  mode: "transient" | "commit";
  // Id for the Transform the move adds when the layer has none. One gesture
  // keeps the same id, so its updates land on the Transform it added.
  newEffectId: string;
};

type DragState = {
  pointerId: number;
  laneId: string;
  startScreen: Point;
  startCanvas: Point;
  startPosition: Point;
  newEffectId: string;
  position?: Point;
};

// Pointer travel, in CSS pixels, before a press on a layer becomes a move.
// Below it a press only selects.
const DRAG_THRESHOLD_PX = 3;

// Covers the whole preview monitor, not just the letterboxed video, so the
// selected layer's outline stays visible where it extends past the frame.
// Clicks pick the topmost layer under the pointer; dragging moves it.
export function PreviewTransformOverlay({
  canvas,
  layers,
  selectedLaneId,
  getLayerPosition,
  onSelect,
  onMove,
}: {
  canvas: Size;
  layers: readonly PreviewLayer[];
  selectedLaneId: string | undefined;
  getLayerPosition: (laneId: string) => Point;
  onSelect: (layer: PreviewLayer | undefined) => void;
  onMove: (move: PreviewLayerMove) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [monitor, setMonitor] = useState<Size>({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const measure = () =>
      setMonitor({ width: root.clientWidth, height: root.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const video = resolveVideoRect(monitor, canvas);
  const selected = layers.find((layer) => layer.laneId === selectedLaneId);

  const toCanvas = (event: { clientX: number; clientY: number }) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    const screen = {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    };
    return { screen, canvas: screenToCanvas(screen, video, canvas) };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.focus({ preventScroll: true });
    const point = toCanvas(event);
    // The selected layer keeps the press anywhere inside its outline, even
    // where another layer is drawn over it.
    const target =
      selected && isPointOnLayer(point.canvas, selected, canvas)
        ? selected
        : hitTestLayers(layers, point.canvas, canvas);
    onSelect(target);
    if (!target) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      laneId: target.laneId,
      startScreen: point.screen,
      startCanvas: point.canvas,
      startPosition: getLayerPosition(target.laneId),
      newEffectId: crypto.randomUUID(),
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const point = toCanvas(event);
    if (
      !drag.position &&
      Math.hypot(
        point.screen.x - drag.startScreen.x,
        point.screen.y - drag.startScreen.y,
      ) < DRAG_THRESHOLD_PX
    ) {
      return;
    }

    const delta = constrainDragDelta(
      {
        x: point.canvas.x - drag.startCanvas.x,
        y: point.canvas.y - drag.startCanvas.y,
      },
      event.shiftKey,
    );
    drag.position = offsetTransformPosition(drag.startPosition, delta, canvas);
    setIsDragging(true);
    onMove({
      laneId: drag.laneId,
      position: drag.position,
      mode: "transient",
      newEffectId: drag.newEffectId,
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.position) {
      onMove({
        laneId: drag.laneId,
        position: drag.position,
        mode: "commit",
        newEffectId: drag.newEffectId,
      });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && selected) {
      event.preventDefault();
      onSelect(undefined);
      return;
    }

    const delta = resolveNudgeDelta(event.key, event.shiftKey);
    if (!delta || !selected || dragRef.current || event.altKey) {
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      return;
    }

    event.preventDefault();
    onMove({
      laneId: selected.laneId,
      position: offsetTransformPosition(
        getLayerPosition(selected.laneId),
        delta,
        canvas,
      ),
      mode: "commit",
      newEffectId: crypto.randomUUID(),
    });
  };

  const outline = selected?.corners
    .map((corner) => {
      const point = canvasToScreen(corner, video, canvas);
      return `${point.x},${point.y}`;
    })
    .join(" ");

  return (
    <div
      ref={rootRef}
      className={`preview-transform-overlay${
        isDragging ? " preview-transform-overlay--dragging" : ""
      }`}
      data-testid="preview-transform-overlay"
      // A canvas surface: layers are picked by position, and the arrow keys
      // nudge the selected one.
      role="application"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus is how the arrow keys reach the selected layer
      tabIndex={0}
      aria-label="Preview. Click a layer to select it, drag or use the arrow keys to move it."
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      {outline && monitor.width > 0 ? (
        <svg
          className="preview-transform-overlay__outline"
          width={monitor.width}
          height={monitor.height}
          aria-hidden="true"
        >
          <polygon
            className="preview-transform-overlay__halo"
            points={outline}
          />
          <polygon
            className="preview-transform-overlay__box"
            data-testid="preview-transform-outline"
            points={outline}
          />
        </svg>
      ) : null}
    </div>
  );
}
