import {
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LayerMove, Point } from "../composition-transform.ts";
import {
  clampMovePoint,
  describeMovePoint,
  insertMoveWaypoint,
  type MoveParameterValues,
  type MovePoint,
  movePointParameters,
  movePoints,
  movePointTransform,
  removeMoveWaypoint,
} from "../fx/effects/move/move-edit.ts";
import { MOVE_WAYPOINT_LIMIT } from "../fx/effects/move/move.ts";
import { useMovePointSelection } from "../fx/effects/move/move-point-selection.ts";
import {
  findPathMove,
  type MovePath,
  nearestAlongPath,
  resolveMovePath,
} from "../move-path.ts";
import {
  canvasToScreen,
  constrainDragDelta,
  offsetTransformPosition,
  type PreviewLayer,
  resolveVideoRect,
  type Size,
  screenToCanvas,
  toParentDelta,
} from "../preview-edit.ts";
import "./preview-move-path.css";

// An edit of a Move's parameters from its path on the preview.
export type PreviewMoveEdit = {
  effectId: string;
  values: MoveParameterValues;
  mode: "transient" | "commit";
};

// Reads and edits a Move's stored parameters, by effect id.
export type PreviewMovePathEditing = {
  getMove: (effectId: string) => LayerMove | undefined;
  onEdit: (edit: PreviewMoveEdit) => void;
};

type DragState = {
  pointerId: number;
  point: MovePoint;
  startClient: Point;
  startPosition: Point;
  // Canvas pixels per CSS pixel when the drag started.
  scale: Point;
  path: MovePath;
  moved: boolean;
};

// Pointer travel, in CSS pixels, before a press on a point drags it.
const DRAG_THRESHOLD_PX = 3;
// How long the hint at the waypoint limit shows.
const HINT_MS = 1600;

// The selected clip's Move path over the preview: its Start, waypoints and
// End as dots joined by the path the clip takes between them. Dragging a dot
// moves that point, clicking the path adds a waypoint there, and
// right-clicking (or Alt-clicking) a waypoint removes it. Only the dots and
// the path itself take the pointer; everywhere else reaches the transform
// overlay beneath.
export function PreviewMovePath({
  canvas,
  layers,
  selectedLaneId,
  selectedClipId,
  editing,
}: {
  canvas: Size;
  layers: readonly PreviewLayer[];
  selectedLaneId: string | undefined;
  selectedClipId: string | undefined;
  editing: PreviewMovePathEditing;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [monitor, setMonitor] = useState<Size>({ width: 0, height: 0 });
  const [hint, setHint] = useState<Point>();
  const selection = useMovePointSelection();

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

  useEffect(() => {
    if (!hint) {
      return;
    }
    const timer = window.setTimeout(() => setHint(undefined), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const layer = layers.find((candidate) => candidate.laneId === selectedLaneId);
  const shown =
    layer && (selectedClipId === undefined || layer.clipId === selectedClipId)
      ? layer
      : undefined;
  const source = shown
    ? findPathMove(
        shown,
        { laneId: shown.laneId, clipId: selectedClipId },
        selection.activeEffectId,
      )
    : undefined;
  const path = shown && source ? resolveMovePath(shown, source, canvas) : null;
  const video = resolveVideoRect(monitor, canvas);
  const toScreen = (point: Point) => canvasToScreen(point, video, canvas);
  const waypointCount = source?.move.waypoints?.length ?? 0;
  const selectedPoint = source
    ? clampMovePoint(selection.read(source.effectId), waypointCount)
    : undefined;

  const local = (event: { clientX: number; clientY: number }) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    };
  };

  const removeWaypoint = (point: number) => {
    const move = source && editing.getMove(source.effectId);
    if (!source || !move) {
      return;
    }
    editing.onEdit({
      effectId: source.effectId,
      values: removeMoveWaypoint(move, point),
      mode: "commit",
    });
    selection.select(source.effectId, point > 1 ? point - 1 : "start");
  };

  const handleDotPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    point: MovePoint,
  ) => {
    event.stopPropagation();
    if (!path || !source || event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (event.altKey) {
      if (typeof point === "number") {
        removeWaypoint(point);
      }
      return;
    }
    const move = editing.getMove(source.effectId);
    if (!move) {
      return;
    }
    selection.select(source.effectId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = movePointTransform(move, point);
    dragRef.current = {
      pointerId: event.pointerId,
      point,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: { x: start.positionX, y: start.positionY },
      scale: {
        x: canvas.width / Math.max(1, video.width),
        y: canvas.height / Math.max(1, video.height),
      },
      path,
      moved: false,
    };
  };

  const handleDotPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const travel = {
      x: event.clientX - drag.startClient.x,
      y: event.clientY - drag.startClient.y,
    };
    if (!drag.moved && Math.hypot(travel.x, travel.y) < DRAG_THRESHOLD_PX) {
      return;
    }
    drag.moved = true;
    const position = offsetTransformPosition(
      drag.startPosition,
      toParentDelta(
        drag.path.parent,
        constrainDragDelta(
          { x: travel.x * drag.scale.x, y: travel.y * drag.scale.y },
          event.shiftKey,
        ),
      ),
      drag.path.surface,
    );
    editing.onEdit({
      effectId: drag.path.source.effectId,
      values: movePointParameters(drag.point, {
        positionX: position.x,
        positionY: position.y,
      }),
      mode: "transient",
    });
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      // Ends the gesture as one undo step, at the last transient values.
      editing.onEdit({
        effectId: drag.path.source.effectId,
        values: {},
        mode: "commit",
      });
    }
  };

  const handleDotContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    point: MovePoint,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof point === "number") {
      removeWaypoint(point);
    }
  };

  const handlePathPointerDown = (event: PointerEvent<SVGPolylineElement>) => {
    event.stopPropagation();
    if (!path || !source || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const screen = local(event);
    if (waypointCount >= MOVE_WAYPOINT_LIMIT) {
      setHint(screen);
      return;
    }
    const move = editing.getMove(source.effectId);
    const inserted =
      move &&
      insertMoveWaypoint(
        move,
        nearestAlongPath(path.samples, screenToCanvas(screen, video, canvas))
          .along,
      );
    if (!inserted) {
      return;
    }
    editing.onEdit({
      effectId: source.effectId,
      values: inserted.parameters,
      mode: "commit",
    });
    selection.select(source.effectId, inserted.point);
  };

  const showPath = Boolean(path && source && monitor.width > 0);
  const line = path?.samples
    .map(({ point }) => {
      const screen = toScreen(point);
      return `${screen.x},${screen.y}`;
    })
    .join(" ");
  return (
    <div
      ref={rootRef}
      className="preview-move-path"
      data-testid="preview-move-path"
    >
      {showPath && path && source ? (
        <>
          <svg
            className="preview-move-path__svg"
            width={monitor.width}
            height={monitor.height}
          >
            <polyline className="preview-move-path__halo" points={line} />
            <polyline className="preview-move-path__line" points={line} />
            <polyline
              className="preview-move-path__hit"
              data-testid="preview-move-path-line"
              points={line}
              onPointerDown={handlePathPointerDown}
            >
              <title>
                {waypointCount >= MOVE_WAYPOINT_LIMIT
                  ? `Motion path. A Move has at most ${MOVE_WAYPOINT_LIMIT} waypoints.`
                  : "Motion path. Click to add a waypoint here."}
              </title>
            </polyline>
          </svg>
          {movePoints(waypointCount).map((point, index) => {
            const screen = toScreen(path.points[index]);
            const name = describeMovePoint(point);
            const isWaypoint = typeof point === "number";
            return (
              <button
                key={String(point)}
                type="button"
                className={`preview-move-path__dot preview-move-path__dot--${
                  isWaypoint ? "waypoint" : point
                }`}
                data-testid={`preview-move-point-${point}`}
                aria-label={`${name} of the Move path`}
                aria-pressed={point === selectedPoint}
                title={
                  isWaypoint
                    ? `${name}. Drag to move it, right-click or Alt-click to remove it.`
                    : `${name}. Drag to move it.`
                }
                style={{ left: screen.x, top: screen.y }}
                onClick={() => selection.select(source.effectId, point)}
                onPointerDown={(event) => handleDotPointerDown(event, point)}
                onPointerMove={handleDotPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => handleDotContextMenu(event, point)}
              >
                {isWaypoint ? point : null}
              </button>
            );
          })}
        </>
      ) : null}
      {hint ? (
        <div
          className="preview-move-path__hint"
          role="status"
          style={{ left: hint.x, top: hint.y }}
        >
          {`A Move has at most ${MOVE_WAYPOINT_LIMIT} waypoints`}
        </div>
      ) : null}
    </div>
  );
}
