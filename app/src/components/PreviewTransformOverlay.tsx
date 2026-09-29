import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  applyMatrix,
  type Box,
  type BoxCorners,
  type LayerTransform,
  type Matrix2D,
  type Point,
} from "../composition-transform.ts";
import {
  canvasToScreen,
  constrainDragDelta,
  hitTestLayers,
  isPointOnLayer,
  matrixRotationDeg,
  offsetTransformPosition,
  type PreviewEditTarget,
  type PreviewLayer,
  resolveNudgeDelta,
  resolvePreviewEditFrame,
  resolveVideoRect,
  type Size,
  screenToCanvas,
  toParentDelta,
} from "../preview-edit.ts";
import {
  handleName,
  layerPointInCanvas,
  moveOrigin,
  RESIZE_HANDLES,
  type ResizeHandle,
  type ResizeResult,
  resizeCursor,
  resizeTransform,
  setOrigin,
  snapOriginPoint,
} from "../preview-resize.ts";
import {
  formatRotation,
  isInRotateZone,
  isOnRotationHandle,
  rotateTransform,
  rotationHandleGeometry,
} from "../preview-rotate.ts";
import {
  resolveTextEditorPlacement,
  type TextEditorKeyAction,
} from "../preview-text-edit.ts";
import type { TextStyle } from "../text-style.ts";
import { didPressEndTextEdit, PreviewTextEditor } from "./PreviewTextEditor";
import "./preview-transform-overlay.css";

// The text clip being edited on the canvas, and where its edits go.
export type PreviewTextEdit = {
  clipId: string;
  style: TextStyle;
  onChangeText: (text: string) => void;
  onAction: (action: TextEditorKeyAction) => void;
};

// A move of the target's Transform: the clip's own when `clipId` is set,
// else the layer's.
export type PreviewLayerMove = PreviewEditTarget & {
  position: Point;
  mode: "transient" | "commit";
  // Id for the Transform the move adds when the layer has none. One gesture
  // keeps the same id, so its updates land on the Transform it added.
  newEffectId: string;
};

// A resize, origin or rotate drag: the Transform fields it sets on the
// target.
export type PreviewLayerTransformEdit = PreviewEditTarget & {
  kind: "resize" | "origin" | "rotate";
  values: Partial<LayerTransform>;
  mode: "transient" | "commit";
  newEffectId: string;
};

type Modifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

type DragState = {
  pointerId: number;
  target: PreviewEditTarget;
  // The matrix above the edited Transform: the layer's Transform when a
  // clip's is edited. Pointer moves are measured in its input space.
  parent: Matrix2D;
  // Page coordinates, so the drag is unaffected if the monitor moves or
  // resizes under it (adding a Transform can grow the FX panel).
  startClient: Point;
  // Canvas pixels per CSS pixel when the drag started.
  scale: Point;
  newEffectId: string;
} & (
  | { kind: "move"; startPosition: Point; position?: Point }
  | {
      kind: "resize";
      handle: ResizeHandle;
      box: Box;
      startTransform: LayerTransform;
      lastClient: Point;
      transform?: LayerTransform;
    }
  | {
      kind: "origin";
      box: Box;
      startTransform: LayerTransform;
      startOrigin: Point;
      transform?: LayerTransform;
    }
  | {
      kind: "rotate";
      startTransform: LayerTransform;
      // Where the origin was on the page when the drag began.
      originClient: Point;
      lastClient: Point;
      transform?: LayerTransform;
    }
);

// Pointer travel, in CSS pixels, before a press on a layer becomes a move.
// Below it a press only selects.
const DRAG_THRESHOLD_PX = 3;
// Screen distance, in CSS pixels, within which resized edges and a dragged
// origin snap.
const SNAP_PX = 6;
// Radius, in CSS pixels, of the origin marker's hit area.
const ORIGIN_HIT_RADIUS_PX = 9;
// The angle readout sits below and right of the pointer, clear of the cursor,
// or on the other side of it within this far of the monitor's edge.
const READOUT_OFFSET_PX = 16;
const READOUT_FLIP_PX = 64;
// A curved double arrow, white on a dark halo like the system cursors, for
// the rotation handle and the rotate zones just outside the corners.
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M5 15a8 8 0 0 1 14 0M5 15l-1-5M5 15l5-1M19 15l1-5M19 15l-5-1' stroke='#07080f' stroke-width='4'/><path d='M5 15a8 8 0 0 1 14 0M5 15l-1-5M5 15l5-1M19 15l1-5M19 15l-5-1' stroke='#fff' stroke-width='1.75'/></g></svg>",
)}") 12 12, crosshair`;

const NO_GUIDES: ResizeResult["guides"] = { x: [], y: [] };

function isMacPlatform() {
  const navigatorWithPlatform = window.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return /mac/i.test(
    navigatorWithPlatform.userAgentData?.platform ??
      window.navigator.platform ??
      "",
  );
}

// Covers the whole preview monitor, not just the letterboxed video, so the
// selected layer's outline, resize handles and origin marker stay visible and
// usable where they extend past the frame. Clicks pick the topmost layer under
// the pointer; dragging moves it. The handles resize it (Shift keeps the
// aspect ratio, Ctrl/Cmd resizes from the centre) and the origin marker moves
// its pivot. The rotation handle above the box, and the zones just outside its
// corners, turn it about its origin (Shift snaps to 15 degrees).
// Double-clicking a layer, or Enter on the selected one, activates it, which
// for a text clip starts typing on the canvas (`textEdit`).
//
// With a clip selected, the edits go to that clip's own Transform, nested in
// its layer's (added on the first edit). With only a layer selected, they go
// to the layer's Transform.
export function PreviewTransformOverlay({
  canvas,
  layers,
  selectedLaneId,
  selectedClipId,
  textEdit,
  getLayerPosition,
  getLayerTransform,
  onSelect,
  onMove,
  onTransform,
  onActivate,
}: {
  canvas: Size;
  layers: readonly PreviewLayer[];
  selectedLaneId: string | undefined;
  // The selected clip, whose own Transform the edits go to; undefined when
  // only a layer is selected.
  selectedClipId?: string;
  textEdit?: PreviewTextEdit;
  getLayerPosition: (target: PreviewEditTarget) => Point;
  getLayerTransform: (target: PreviewEditTarget) => LayerTransform;
  onSelect: (layer: PreviewLayer | undefined) => void;
  onMove: (move: PreviewLayerMove) => void;
  onTransform: (edit: PreviewLayerTransformEdit) => void;
  onActivate?: (layer: PreviewLayer) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [monitor, setMonitor] = useState<Size>({ width: 0, height: 0 });
  const [dragCursor, setDragCursor] = useState<string>();
  const [guides, setGuides] = useState(NO_GUIDES);
  const [isRotateHover, setIsRotateHover] = useState(false);
  const [readout, setReadout] = useState<
    { x: number; y: number; text: string } | undefined
  >();

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
  // A selected clip is edited in its own Transform; a layer selected on its
  // own, in the layer's.
  const editsClip = selectedClipId !== undefined;
  const selectedFrame = selected
    ? resolvePreviewEditFrame(selected, editsClip, canvas)
    : undefined;
  const selectedBox = selectedFrame?.box;
  const selectedTarget = selected ? editTarget(selected, editsClip) : undefined;
  const editedLayer = textEdit
    ? layers.find((layer) => layer.clipId === textEdit.clipId)
    : undefined;
  const selectedCorners = selectedFrame?.corners.map((corner) =>
    canvasToScreen(corner, video, canvas),
  ) as BoxCorners | undefined;
  // The rotation handle and rotate zones step aside, like the other handles,
  // while text is typed on the canvas.
  const rotateCorners = editedLayer ? undefined : selectedCorners;
  // Canvas pixels per CSS pixel at the current zoom.
  const scale = {
    x: canvas.width / Math.max(1, video.width),
    y: canvas.height / Math.max(1, video.height),
  };
  // A drag measures the pointer's travel on the page at the zoom it started
  // at, so a preview that moves or resizes mid-drag doesn't make it jump.
  // The travel is in the edited Transform's own space, inside its parent.
  const dragDelta = (drag: DragState, client: Point) =>
    toParentDelta(drag.parent, {
      x: (client.x - drag.startClient.x) * drag.scale.x,
      y: (client.y - drag.startClient.y) * drag.scale.y,
    });

  const toCanvas = (event: { clientX: number; clientY: number }) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    const screen = {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    };
    return { screen, canvas: screenToCanvas(screen, video, canvas) };
  };

  // Editing a selected clip's Transform from a handle selects the clip the
  // preview shows on its layer, if another clip on the layer was selected.
  const selectShownClip = (layer: PreviewLayer) => {
    if (editsClip && selectedClipId !== layer.clipId) {
      onSelect(layer);
    }
  };

  // The selected layer keeps the press anywhere inside its outline, even
  // where another layer is drawn over it.
  const pickLayer = (point: Point) =>
    selected && isPointOnLayer(point, selected, canvas)
      ? selected
      : hitTestLayers(layers, point, canvas);

  // Recomputes a resize from the pointer and the modifiers held right now,
  // so pressing or releasing one mid-drag switches behaviour at once.
  const updateResize = (pointerClient: Point, modifiers: Modifiers) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "resize") {
      return;
    }

    drag.lastClient = pointerClient;
    const delta = dragDelta(drag, pointerClient);
    if (!drag.transform && delta.x === 0 && delta.y === 0) {
      return;
    }

    const fromCenter = isMacPlatform() ? modifiers.metaKey : modifiers.ctrlKey;
    const result = resizeTransform(
      drag.startTransform,
      drag.handle,
      delta,
      drag.box,
      canvas,
      { proportional: modifiers.shiftKey, fromCenter },
      resolveResizeSnap(drag.parent, canvas, SNAP_PX * drag.scale.x),
    );
    drag.transform = result.transform;
    const guides = guidesInCanvas(drag.parent, result.guides);
    setGuides(guides.x.length || guides.y.length ? guides : NO_GUIDES);
    onTransform({
      ...drag.target,
      kind: "resize",
      values: resizeValues(result.transform),
      mode: "transient",
      newEffectId: drag.newEffectId,
    });
  };
  const updateResizeRef = useRef(updateResize);
  updateResizeRef.current = updateResize;

  // A rotation is the pointer's turn about the origin, measured on the page
  // from where both were when the drag began, so a preview that moves or
  // resizes mid-drag doesn't make it jump.
  const updateRotate = (pointerClient: Point, modifiers: Modifiers) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "rotate") {
      return;
    }

    drag.lastClient = pointerClient;
    if (
      !drag.transform &&
      Math.hypot(
        pointerClient.x - drag.startClient.x,
        pointerClient.y - drag.startClient.y,
      ) < DRAG_THRESHOLD_PX
    ) {
      return;
    }

    drag.transform = rotateTransform(
      drag.startTransform,
      drag.originClient,
      drag.startClient,
      pointerClient,
      { snap15: modifiers.shiftKey },
    );
    const bounds = rootRef.current?.getBoundingClientRect();
    setReadout({
      x: pointerClient.x - (bounds?.left ?? 0),
      y: pointerClient.y - (bounds?.top ?? 0),
      text: formatRotation(drag.transform.rotationDeg),
    });
    onTransform({
      ...drag.target,
      kind: "rotate",
      values: rotateValues(drag.transform),
      mode: "transient",
      newEffectId: drag.newEffectId,
    });
  };
  const updateRotateRef = useRef(updateRotate);
  updateRotateRef.current = updateRotate;

  // Resizes and rotations follow modifier keys pressed or released mid-drag.
  const tracksModifiers = dragCursor !== undefined && dragCursor !== "grabbing";
  useEffect(() => {
    if (!tracksModifiers) {
      return;
    }

    const onModifier = (event: globalThis.KeyboardEvent) => {
      const drag = dragRef.current;
      if (
        drag?.kind === "resize" &&
        (event.key === "Shift" ||
          event.key === "Control" ||
          event.key === "Meta")
      ) {
        updateResizeRef.current(drag.lastClient, event);
      } else if (drag?.kind === "rotate" && event.key === "Shift") {
        updateRotateRef.current(drag.lastClient, event);
      }
    };
    window.addEventListener("keydown", onModifier);
    window.addEventListener("keyup", onModifier);
    return () => {
      window.removeEventListener("keydown", onModifier);
      window.removeEventListener("keyup", onModifier);
    };
  }, [tracksModifiers]);

  const startRotate = (
    event: PointerEvent<HTMLDivElement>,
    target: PreviewEditTarget,
    parent: Matrix2D,
    box: Box,
    point: { screen: Point; canvas: Point },
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startTransform = getLayerTransform(target);
    const client = { x: event.clientX, y: event.clientY };
    const originScreen = canvasToScreen(
      applyMatrix(
        parent,
        layerPointInCanvas(
          { x: startTransform.originX, y: startTransform.originY },
          startTransform,
          box,
          canvas,
        ),
      ),
      video,
      canvas,
    );
    dragRef.current = {
      kind: "rotate",
      pointerId: event.pointerId,
      target,
      parent,
      startClient: client,
      scale,
      newEffectId: crypto.randomUUID(),
      startTransform,
      originClient: {
        x: client.x + originScreen.x - point.screen.x,
        y: client.y + originScreen.y - point.screen.y,
      },
      lastClient: client,
    };
    setIsRotateHover(false);
    setDragCursor(ROTATE_CURSOR);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.focus({ preventScroll: true });
    const client = { x: event.clientX, y: event.clientY };
    const point = toCanvas(event);
    const control =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(
            "[data-transform-handle], [data-transform-origin], [data-transform-rotate]",
          )
        : null;
    // Handles on the box win over the rotate zones around its corners. A
    // press that just finished editing text never rotates, as the zones were
    // hidden when it landed.
    if (
      selected &&
      selectedFrame &&
      selectedTarget &&
      rotateCorners &&
      !didPressEndTextEdit(event.nativeEvent) &&
      (control?.dataset.transformRotate !== undefined ||
        (!control && isInRotateZone(point.screen, rotateCorners)))
    ) {
      selectShownClip(selected);
      startRotate(
        event,
        selectedTarget,
        selectedFrame.parent,
        selectedFrame.box,
        point,
      );
      return;
    }

    if (selected && selectedFrame && selectedTarget && control) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      selectShownClip(selected);
      const startTransform = getLayerTransform(selectedTarget);
      const selectedBox = selectedFrame.box;
      const common = {
        pointerId: event.pointerId,
        target: selectedTarget,
        parent: selectedFrame.parent,
        startClient: client,
        scale,
        newEffectId: crypto.randomUUID(),
        box: selectedBox,
        startTransform,
      };
      const handle = RESIZE_HANDLES.find(
        (candidate) =>
          handleName(candidate) === control.dataset.transformHandle,
      );
      if (handle) {
        dragRef.current = {
          ...common,
          kind: "resize",
          handle,
          lastClient: client,
        };
        setDragCursor(
          resizeCursor(
            handle,
            startTransform.rotationDeg +
              matrixRotationDeg(selectedFrame.parent),
          ),
        );
      } else {
        dragRef.current = {
          ...common,
          kind: "origin",
          startOrigin: layerPointInCanvas(
            { x: startTransform.originX, y: startTransform.originY },
            startTransform,
            selectedBox,
            canvas,
          ),
        };
      }
      return;
    }

    const layer = pickLayer(point.canvas);
    // Pressing a layer selects its clip, whose own Transform the drag then
    // moves, unless the layer is already selected on its own: then the drag
    // moves the layer.
    const movesLayer =
      layer !== undefined &&
      layer.laneId === selectedLaneId &&
      selectedClipId === undefined;
    if (!movesLayer) {
      onSelect(layer);
    }
    if (!layer) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = editTarget(layer, !movesLayer);
    dragRef.current = {
      kind: "move",
      pointerId: event.pointerId,
      target,
      parent: resolvePreviewEditFrame(layer, !movesLayer, canvas).parent,
      startClient: client,
      scale,
      startPosition: getLayerPosition(target),
      newEffectId: crypto.randomUUID(),
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      setIsRotateHover(
        rotateCorners !== undefined &&
          isInRotateZone(toCanvas(event).screen, rotateCorners),
      );
      return;
    }

    if (drag.pointerId !== event.pointerId) {
      return;
    }

    const client = { x: event.clientX, y: event.clientY };
    if (drag.kind === "resize") {
      updateResize(client, event);
      return;
    }

    if (drag.kind === "rotate") {
      updateRotate(client, event);
      return;
    }

    const moved = drag.kind === "move" ? drag.position : drag.transform;
    if (
      !moved &&
      Math.hypot(client.x - drag.startClient.x, client.y - drag.startClient.y) <
        DRAG_THRESHOLD_PX
    ) {
      return;
    }

    const delta = dragDelta(drag, client);
    if (drag.kind === "origin") {
      const origin = snapOriginPoint(
        { x: drag.startOrigin.x + delta.x, y: drag.startOrigin.y + delta.y },
        drag.startTransform,
        drag.box,
        canvas,
        (SNAP_PX * drag.scale.x) / matrixScale(drag.parent),
      );
      drag.transform = moveOrigin(
        drag.startTransform,
        origin,
        drag.box,
        canvas,
      );
      setDragCursor("grabbing");
      onTransform({
        ...drag.target,
        kind: "origin",
        values: originValues(drag.transform),
        mode: "transient",
        newEffectId: drag.newEffectId,
      });
      return;
    }

    drag.position = offsetTransformPosition(
      drag.startPosition,
      constrainDragDelta(delta, event.shiftKey),
      canvas,
    );
    setDragCursor("grabbing");
    onMove({
      ...drag.target,
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
    setDragCursor(undefined);
    setGuides(NO_GUIDES);
    setReadout(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.kind === "move") {
      if (drag.position) {
        onMove({
          ...drag.target,
          position: drag.position,
          mode: "commit",
          newEffectId: drag.newEffectId,
        });
      }
      return;
    }

    if (drag.transform) {
      onTransform({
        ...drag.target,
        kind: drag.kind,
        values:
          drag.kind === "resize"
            ? resizeValues(drag.transform)
            : drag.kind === "rotate"
              ? rotateValues(drag.transform)
              : originValues(drag.transform),
        mode: "commit",
        newEffectId: drag.newEffectId,
      });
    }
  };

  // Double-clicking the rotation handle straightens the layer. Double-clicking
  // a moved origin marker puts the origin back at the centre; anywhere else,
  // including a marker already at the centre, it activates the layer under the
  // pointer. The pointer is captured by the overlay while pressed, so the
  // handle and marker are found by position rather than by the event target.
  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const point = toCanvas(event);
    if (
      selectedTarget &&
      rotateCorners &&
      isOnRotationHandle(point.screen, rotateCorners)
    ) {
      event.preventDefault();
      if (getLayerTransform(selectedTarget).rotationDeg !== 0) {
        onTransform({
          ...selectedTarget,
          kind: "rotate",
          values: { rotationDeg: 0 },
          mode: "commit",
          newEffectId: crypto.randomUUID(),
        });
      }
      return;
    }

    const start =
      selectedTarget && selectedBox && originScreen
        ? getLayerTransform(selectedTarget)
        : undefined;
    if (
      !selectedTarget ||
      !selectedBox ||
      !originScreen ||
      !start ||
      (start.originX === 0 && start.originY === 0) ||
      Math.hypot(
        point.screen.x - originScreen.x,
        point.screen.y - originScreen.y,
      ) > ORIGIN_HIT_RADIUS_PX
    ) {
      const target = onActivate ? pickLayer(point.canvas) : undefined;
      if (target) {
        event.preventDefault();
        onActivate?.(target);
      }
      return;
    }

    event.preventDefault();
    onTransform({
      ...selectedTarget,
      kind: "origin",
      values: originValues(
        setOrigin(start, { x: 0, y: 0 }, selectedBox, canvas),
      ),
      mode: "commit",
      newEffectId: crypto.randomUUID(),
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key === "Enter" &&
      selected &&
      onActivate &&
      !dragRef.current &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      onActivate(selected);
      return;
    }

    if (event.key === "Escape" && selected) {
      event.preventDefault();
      onSelect(undefined);
      return;
    }

    const delta = resolveNudgeDelta(event.key, event.shiftKey);
    if (
      !delta ||
      !selectedTarget ||
      !selectedFrame ||
      dragRef.current ||
      event.altKey
    ) {
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      return;
    }

    event.preventDefault();
    onMove({
      ...selectedTarget,
      position: offsetTransformPosition(
        getLayerPosition(selectedTarget),
        toParentDelta(selectedFrame.parent, delta),
        canvas,
      ),
      mode: "commit",
      newEffectId: crypto.randomUUID(),
    });
  };

  const toScreen = (local: Point) =>
    selectedFrame
      ? canvasToScreen(
          applyMatrix(
            selectedFrame.parent,
            layerPointInCanvas(
              local,
              selectedFrame.transform,
              selectedFrame.box,
              canvas,
            ),
          ),
          video,
          canvas,
        )
      : undefined;
  const outline = selectedCorners
    ?.map((point) => `${point.x},${point.y}`)
    .join(" ");
  const rotationHandle = rotateCorners
    ? rotationHandleGeometry(rotateCorners)
    : undefined;
  // The handles and origin marker step aside while text is typed on the
  // canvas, so they don't cover the editor.
  const originScreen =
    selectedFrame && !editedLayer
      ? toScreen({
          x: selectedFrame.transform.originX,
          y: selectedFrame.transform.originY,
        })
      : undefined;
  const rotationDeg = selectedFrame
    ? selectedFrame.transform.rotationDeg +
      matrixRotationDeg(selectedFrame.parent)
    : 0;
  const showControls = Boolean(outline && monitor.width > 0);
  const showHandles = showControls && !editedLayer;
  const videoBottom = video.top + video.height;
  const videoRight = video.left + video.width;

  return (
    <div
      ref={rootRef}
      className={`preview-transform-overlay${
        dragCursor ? " preview-transform-overlay--dragging" : ""
      }`}
      style={
        dragCursor || isRotateHover
          ? { cursor: dragCursor ?? ROTATE_CURSOR }
          : undefined
      }
      data-testid="preview-transform-overlay"
      // A canvas surface: layers are picked by position, and the arrow keys
      // nudge the selected one.
      role="application"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus is how the arrow keys reach the selected layer
      tabIndex={0}
      aria-label="Preview. Click a layer to select it, drag or use the arrow keys to move it, drag a handle to resize it, drag the rotation handle or just outside a corner to rotate it. Double-click a text clip or press Enter to edit its text."
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setIsRotateHover(false)}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {showControls && outline ? (
        <svg
          className="preview-transform-overlay__outline"
          width={monitor.width}
          height={monitor.height}
          aria-hidden="true"
        >
          {guides.x.map((line) => {
            const x = canvasToScreen({ x: line, y: 0 }, video, canvas).x;
            return (
              <line
                key={`x${line}`}
                className="preview-transform-overlay__guide"
                data-testid="preview-transform-guide"
                x1={x}
                x2={x}
                y1={Math.min(0, video.top)}
                y2={Math.max(monitor.height, videoBottom)}
              />
            );
          })}
          {guides.y.map((line) => {
            const y = canvasToScreen({ x: 0, y: line }, video, canvas).y;
            return (
              <line
                key={`y${line}`}
                className="preview-transform-overlay__guide"
                data-testid="preview-transform-guide"
                x1={Math.min(0, video.left)}
                x2={Math.max(monitor.width, videoRight)}
                y1={y}
                y2={y}
              />
            );
          })}
          <polygon
            className="preview-transform-overlay__halo"
            points={outline}
          />
          <polygon
            className="preview-transform-overlay__box"
            data-testid="preview-transform-outline"
            points={outline}
          />
          {rotationHandle ? (
            <g>
              <line
                className="preview-transform-overlay__halo"
                x1={rotationHandle.stemStart.x}
                y1={rotationHandle.stemStart.y}
                x2={rotationHandle.handle.x}
                y2={rotationHandle.handle.y}
              />
              <line
                className="preview-transform-overlay__box"
                x1={rotationHandle.stemStart.x}
                y1={rotationHandle.stemStart.y}
                x2={rotationHandle.handle.x}
                y2={rotationHandle.handle.y}
              />
            </g>
          ) : null}
          {originScreen ? (
            <g
              className="preview-transform-overlay__origin-mark"
              transform={`translate(${originScreen.x} ${originScreen.y})`}
            >
              <circle r={5.5} />
              <line x1={-9} x2={9} y1={0} y2={0} />
              <line x1={0} x2={0} y1={-9} y2={9} />
            </g>
          ) : null}
        </svg>
      ) : null}
      {showControls && rotationHandle ? (
        <div
          className="preview-transform-overlay__rotate-handle"
          data-transform-rotate=""
          data-testid="preview-rotation-handle"
          title="Rotate. Drag to turn about the origin, Shift for 15° steps, double-click to straighten."
          style={{
            left: rotationHandle.handle.x,
            top: rotationHandle.handle.y,
            cursor: ROTATE_CURSOR,
          }}
        />
      ) : null}
      {showControls && originScreen ? (
        <div
          className="preview-transform-overlay__origin"
          data-transform-origin=""
          data-testid="preview-transform-origin"
          title="Origin. Drag to move the pivot, double-click to centre it."
          style={{ left: originScreen.x, top: originScreen.y }}
        />
      ) : null}
      {showHandles
        ? RESIZE_HANDLES.map((handle) => {
            const point = toScreen(handle);
            if (!point) {
              return null;
            }

            const name = handleName(handle);
            return (
              <div
                key={name}
                className="preview-transform-overlay__handle"
                data-transform-handle={name}
                data-testid={`preview-transform-handle-${name}`}
                style={{
                  left: point.x,
                  top: point.y,
                  cursor: resizeCursor(handle, rotationDeg),
                  transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
                }}
              />
            );
          })
        : null}
      {textEdit && editedLayer && monitor.width > 0 ? (
        <PreviewTextEditor
          canvas={canvas}
          placement={resolveTextEditorPlacement(editedLayer, video, canvas)}
          style={textEdit.style}
          onChangeText={textEdit.onChangeText}
          onAction={textEdit.onAction}
        />
      ) : null}
      {readout ? (
        <div
          className="preview-transform-overlay__readout"
          data-testid="preview-rotation-readout"
          style={{
            left: readout.x,
            top: readout.y,
            transform: `translate(${
              readout.x > monitor.width - READOUT_FLIP_PX
                ? `calc(-100% - ${READOUT_OFFSET_PX}px)`
                : `${READOUT_OFFSET_PX}px`
            }, ${
              readout.y > monitor.height - READOUT_FLIP_PX
                ? `calc(-100% - ${READOUT_OFFSET_PX}px)`
                : `${READOUT_OFFSET_PX}px`
            })`,
          }}
        >
          {readout.text}
        </div>
      ) : null}
    </div>
  );
}

function editTarget(
  layer: PreviewLayer,
  editsClip: boolean,
): PreviewEditTarget {
  return editsClip
    ? { laneId: layer.laneId, clipId: layer.clipId }
    : { laneId: layer.laneId };
}

// How much `parent` scales a length, on average over its two axes.
function matrixScale(parent: Matrix2D) {
  return Math.max(
    1e-6,
    (Math.hypot(parent.a, parent.b) + Math.hypot(parent.c, parent.d)) / 2,
  );
}

function isAxisAligned(parent: Matrix2D) {
  return Math.abs(parent.b) < 1e-9 && Math.abs(parent.c) < 1e-9;
}

// Resized edges snap to the canvas edges and centre lines. For a clip inside
// a moved or scaled layer, the lines are taken into the clip's space; inside
// a turned layer they no longer line up with its edges, so nothing snaps.
function resolveResizeSnap(parent: Matrix2D, canvas: Size, threshold: number) {
  const xLines = [0, canvas.width / 2, canvas.width];
  const yLines = [0, canvas.height / 2, canvas.height];
  if (!isAxisAligned(parent)) {
    return undefined;
  }

  return {
    xLines: xLines.map((x) => (x - parent.e) / parent.a),
    yLines: yLines.map((y) => (y - parent.f) / parent.d),
    threshold: threshold / matrixScale(parent),
  };
}

// Snapped lines from the edited Transform's space, back on the canvas.
function guidesInCanvas(
  parent: Matrix2D,
  guides: ResizeResult["guides"],
): ResizeResult["guides"] {
  return {
    x: guides.x.map((x) => parent.a * x + parent.e),
    y: guides.y.map((y) => parent.d * y + parent.f),
  };
}

function resizeValues(transform: LayerTransform): Partial<LayerTransform> {
  return {
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    positionX: transform.positionX,
    positionY: transform.positionY,
  };
}

function originValues(transform: LayerTransform): Partial<LayerTransform> {
  return {
    originX: transform.originX,
    originY: transform.originY,
    positionX: transform.positionX,
    positionY: transform.positionY,
  };
}

function rotateValues(transform: LayerTransform): Partial<LayerTransform> {
  return { rotationDeg: transform.rotationDeg };
}
