import { useRef, useState } from "react";
import { describe, expect, test } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-react";
import { resolveCanvasBounds } from "../composition-layout.ts";
import {
  IDENTITY_TRANSFORM,
  type LayerTransform,
} from "../composition-transform.ts";
import { type PreviewLayer, resolvePreviewEditFrame } from "../preview-edit.ts";
import {
  type PreviewLayerMove,
  type PreviewLayerTransformEdit,
  PreviewTransformOverlay,
} from "./PreviewTransformOverlay";

// The selected layer's resize handles, origin marker and rotation handle in
// the preview: Shift keeps the aspect ratio, Ctrl/Cmd resizes from the
// center, dragging the origin leaves the layer in place, the handle and the
// zones just outside the corners rotate with a live angle readout (Shift
// snaps to 15 degrees), and every drag commits one edit. The controls sit in
// the unclipped overlay, so they work past the video edge. Ported from
// e2e/preview-resize.spec.ts and e2e/preview-rotate.spec.ts; the app turns
// each committed edit into one undo step (usePreviewEditing).
//
// The layer fills a 1920x1080 canvas, letterboxed into an 800x600 monitor.
const CANVAS = { width: 1920, height: 1080 };
const MONITOR = { width: 800, height: 600 };
const SHIFT = 8;
const FROM_CENTER = /mac/i.test(navigator.platform)
  ? { key: "Meta", code: "MetaLeft", keyCode: 91, modifier: 4 }
  : { key: "Control", code: "ControlLeft", keyCode: 17, modifier: 2 };

type Point = { x: number; y: number };
type Edit = PreviewLayerMove | PreviewLayerTransformEdit;

function layerWith(clipTransform: LayerTransform): PreviewLayer {
  const layer = {
    laneId: "1",
    clipId: "clip-1",
    placement: { frame: resolveCanvasBounds(CANVAS.width, CANVAS.height) },
    transform: IDENTITY_TRANSFORM,
    clipTransform,
  };
  return {
    ...layer,
    corners: resolvePreviewEditFrame(layer, true, CANVAS).corners,
  };
}

// The overlay over a selected clip, applying its edits to the clip's own
// Transform as the app does, and recording them in `edits`.
function Monitor({ edits }: { edits: Edit[] }) {
  const [transform, setTransform] = useState(IDENTITY_TRANSFORM);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  return (
    <div
      style={{
        position: "relative",
        margin: 40,
        width: MONITOR.width,
        height: MONITOR.height,
      }}
    >
      <PreviewTransformOverlay
        canvas={CANVAS}
        layers={[layerWith(transform)]}
        selectedLaneId="1"
        selectedClipId="clip-1"
        getLayerPosition={() => ({
          x: transformRef.current.positionX,
          y: transformRef.current.positionY,
        })}
        getLayerTransform={() => transformRef.current}
        onSelect={() => {}}
        onMove={(move) => {
          edits.push(move);
          setTransform((current) => ({
            ...current,
            positionX: move.position.x,
            positionY: move.position.y,
          }));
        }}
        onTransform={(edit) => {
          edits.push(edit);
          setTransform((current) => ({ ...current, ...edit.values }));
        }}
      />
    </div>
  );
}

async function renderMonitor() {
  const edits: Edit[] = [];
  await render(<Monitor edits={edits} />);
  await nextFrame();
  return edits;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function byTestId(id: string) {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) {
    throw new Error(`${id} is not rendered`);
  }
  return element;
}

function centerOf(id: string): Point {
  const box = byTestId(id).getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// The letterboxed video inside the monitor, in page coordinates.
function videoRect() {
  const bounds = byTestId("preview-transform-overlay").getBoundingClientRect();
  const fit = Math.min(
    bounds.width / CANVAS.width,
    bounds.height / CANVAS.height,
  );
  const width = CANVAS.width * fit;
  const height = CANVAS.height * fit;
  return {
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + (bounds.height - height) / 2,
    width,
    height,
  };
}

// The outline's corners in page coordinates, clockwise from the top-left.
function outlineCorners(): Point[] {
  const outline = byTestId("preview-transform-outline");
  const monitor = byTestId("preview-transform-overlay").getBoundingClientRect();
  return (outline.getAttribute("points") ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x + monitor.x, y: y + monitor.y };
    });
}

// The outline's bounds, in page coordinates, without its stroke.
function outlineBox() {
  const corners = outlineCorners();
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// The outline's rotation, from its top edge: 0 when level, positive
// clockwise.
function outlineRotation() {
  const [topLeft, topRight] = outlineCorners();
  return (
    (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) / Math.PI
  );
}

// The middle of the outline, which is the layer's default origin.
function outlineCenter(): Point {
  const corners = outlineCorners();
  return {
    x: corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length,
    y: corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length,
  };
}

// Real input through the DevTools protocol, so pointer capture, modifier
// keys and double-clicks behave as with a mouse. It tracks the held mouse
// button and modifiers as Playwright's mouse and keyboard do.
const input = { x: 0, y: 0, buttons: 0, modifiers: 0 };

function framePoint({ x, y }: Point) {
  const frame = window.frameElement?.getBoundingClientRect();
  return { x: x + (frame?.left ?? 0), y: y + (frame?.top ?? 0) };
}

async function mouseEvent(
  type: "mouseMoved" | "mousePressed" | "mouseReleased",
  clickCount = 1,
) {
  await cdp().send("Input.dispatchMouseEvent", {
    type,
    ...framePoint(input),
    button: type === "mouseMoved" && !input.buttons ? "none" : "left",
    buttons: input.buttons,
    clickCount,
    modifiers: input.modifiers,
  });
}

async function mouseMove(to: Point, steps = 1) {
  const from = { x: input.x, y: input.y };
  for (let step = 1; step <= steps; step += 1) {
    input.x = from.x + ((to.x - from.x) * step) / steps;
    input.y = from.y + ((to.y - from.y) * step) / steps;
    await mouseEvent("mouseMoved");
  }
  await nextFrame();
}

async function mouseDown() {
  input.buttons = 1;
  await mouseEvent("mousePressed");
  await nextFrame();
}

async function mouseUp() {
  input.buttons = 0;
  await mouseEvent("mouseReleased");
  await nextFrame();
}

async function doubleClick(at: Point) {
  await mouseMove(at);
  for (const clickCount of [1, 2]) {
    input.buttons = 1;
    await mouseEvent("mousePressed", clickCount);
    input.buttons = 0;
    await mouseEvent("mouseReleased", clickCount);
  }
  await nextFrame();
}

async function key(
  type: "keyDown" | "keyUp",
  { key, code, keyCode, modifier }: typeof FROM_CENTER,
) {
  input.modifiers =
    type === "keyDown"
      ? input.modifiers | modifier
      : input.modifiers & ~modifier;
  await cdp().send("Input.dispatchKeyEvent", {
    type: type === "keyDown" ? "rawKeyDown" : "keyUp",
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    modifiers: input.modifiers,
  });
  await nextFrame();
}

const SHIFT_KEY = {
  key: "Shift",
  code: "ShiftLeft",
  keyCode: 16,
  modifier: SHIFT,
};

async function drag(from: Point, to: Point) {
  await mouseMove(from);
  await mouseDown();
  await mouseMove({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, 4);
  await mouseMove(to, 4);
  await mouseUp();
}

// `point` turned `degrees` clockwise about `origin`.
function turn(point: Point, origin: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: origin.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

async function dragAround(from: Point, origin: Point, degrees: number) {
  await mouseMove(from);
  await mouseDown();
  for (let step = 1; step <= 6; step += 1) {
    await mouseMove(turn(from, origin, (degrees * step) / 6));
  }
}

// The drag committed exactly one edit of `kind`, the app's one undo step,
// and its live updates went to the same Transform. Clears `edits`.
function expectOneCommit(
  edits: Edit[],
  kind: "move" | PreviewLayerTransformEdit["kind"],
) {
  const commits = edits.filter((edit) => edit.mode === "commit");
  expect(commits).toHaveLength(1);
  const [commit] = commits;
  expect("kind" in commit ? commit.kind : "move").toBe(kind);
  for (const edit of edits) {
    expect(edit.newEffectId).toBe(commit.newEffectId);
  }
  edits.length = 0;
}

function expectClose(actual: number, expected: number, tolerance = 2) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function readout() {
  return document.querySelector('[data-testid="preview-rotation-readout"]');
}

describe("resizing", () => {
  test("the selected layer shows eight handles and an origin marker", async () => {
    await renderMonitor();
    const video = videoRect();
    expect(document.querySelectorAll("[data-transform-handle]")).toHaveLength(
      8,
    );
    const origin = centerOf("preview-transform-origin");
    expectClose(origin.x, video.left + video.width / 2);
    expectClose(origin.y, video.top + video.height / 2);
    expect(
      getComputedStyle(byTestId("preview-transform-handle-se")).cursor,
    ).toBe("nwse-resize");
    expect(
      getComputedStyle(byTestId("preview-transform-handle-e")).cursor,
    ).toBe("ew-resize");
  });

  test("a corner drag with Shift and Ctrl/Cmd scales proportionally about the center", async () => {
    const edits = await renderMonitor();
    const video = videoRect();
    const before = outlineBox();
    const handle = centerOf("preview-transform-handle-se");
    // Grab the handle a little inside the frame, where the app's monitor
    // clips it.
    const corner = { x: handle.x - 3, y: handle.y - 3 };

    await key("keyDown", SHIFT_KEY);
    await key("keyDown", FROM_CENTER);
    // Mostly sideways: Shift still shrinks both axes by the same factor.
    await drag(corner, {
      x: corner.x - video.width * 0.25,
      y: corner.y - video.height * 0.05,
    });
    await key("keyUp", FROM_CENTER);
    await key("keyUp", SHIFT_KEY);

    const after = outlineBox();
    expect(after.width).toBeLessThan(before.width * 0.9);
    // Proportional: the aspect ratio holds.
    expectClose(after.width / after.height, before.width / before.height, 0.02);
    // From the center: it shrank evenly on every side.
    expectClose(after.x + after.width / 2, before.x + before.width / 2);
    expectClose(after.y + after.height / 2, before.y + before.height / 2);
    expectOneCommit(edits, "resize");
  });

  test("an edge drag resizes one side and keeps the opposite edge", async () => {
    const edits = await renderMonitor();
    const video = videoRect();
    const before = outlineBox();
    const edge = centerOf("preview-transform-handle-e");

    await mouseMove(edge);
    await mouseDown();
    await mouseMove({ x: edge.x - video.width * 0.2, y: edge.y + 30 }, 6);
    let during = outlineBox();
    expectClose(during.x, before.x);
    expectClose(during.height, before.height);
    expectClose(during.width, before.width * 0.8, 3);

    // Pressing Shift mid-drag switches to proportional at once.
    await key("keyDown", SHIFT_KEY);
    await expect.poll(() => outlineBox().height).toBeLessThan(
      before.height * 0.9,
    );
    during = outlineBox();
    expectClose(
      during.width / during.height,
      before.width / before.height,
      0.02,
    );
    await key("keyUp", SHIFT_KEY);
    await expect
      .poll(() => outlineBox().height)
      .toBeGreaterThan(before.height - 2);
    await mouseUp();

    const after = outlineBox();
    expectClose(after.x, before.x);
    expectClose(after.width, before.width * 0.8, 3);
    expectOneCommit(edits, "resize");
  });

  test("dragging the origin moves the pivot but not the layer", async () => {
    const edits = await renderMonitor();
    const video = videoRect();
    const before = outlineBox();
    const origin = centerOf("preview-transform-origin");

    const target = {
      x: video.left + video.width * 0.8,
      y: video.top + video.height * 0.3,
    };
    await drag(origin, target);

    const moved = centerOf("preview-transform-origin");
    expectClose(moved.x, target.x);
    expectClose(moved.y, target.y);
    const after = outlineBox();
    expectClose(after.x, before.x);
    expectClose(after.y, before.y);
    expectClose(after.width, before.width);
    expectClose(after.height, before.height);
    expectOneCommit(edits, "origin");

    // It snaps to a corner nearby.
    const corner = centerOf("preview-transform-handle-ne");
    await drag(moved, { x: corner.x - 4, y: corner.y + 3 });
    const snapped = centerOf("preview-transform-origin");
    expectClose(snapped.x, corner.x, 1);
    expectClose(snapped.y, corner.y, 1);

    // Double-clicking it puts it back in the center, still without moving
    // the layer.
    await doubleClick(snapped);
    const reset = centerOf("preview-transform-origin");
    expectClose(reset.x, video.left + video.width / 2);
    expectClose(reset.y, video.top + video.height / 2);
    const unchanged = outlineBox();
    expectClose(unchanged.x, before.x);
    expectClose(unchanged.width, before.width);
  });

  test("handles outside the video area can still be dragged", async () => {
    const edits = await renderMonitor();
    const video = videoRect();
    const monitor = byTestId(
      "preview-transform-overlay",
    ).getBoundingClientRect();

    // Move the layer halfway into the monitor's letterbox or pillarbox bar,
    // so one edge and its handle sit outside the video.
    const barX = monitor.x + monitor.width - (video.left + video.width);
    const barY = monitor.y + monitor.height - (video.top + video.height);
    const sideways = barX >= barY;
    expect(Math.max(barX, barY)).toBeGreaterThan(16);
    // Grab the layer away from the origin marker in its center.
    const grab = {
      x: video.left + video.width * 0.3,
      y: video.top + video.height * 0.3,
    };
    await drag(grab, {
      x: grab.x + (sideways ? barX / 2 : 0),
      y: grab.y + (sideways ? 0 : barY / 2),
    });
    expectOneCommit(edits, "move");
    const moved = outlineBox();
    const handle = centerOf(
      `preview-transform-handle-${sideways ? "e" : "s"}`,
    );
    if (sideways) {
      expect(handle.x).toBeGreaterThan(video.left + video.width + 4);
    } else {
      expect(handle.y).toBeGreaterThan(video.top + video.height + 4);
    }

    const shrink = sideways ? video.width * 0.3 : video.height * 0.3;
    await drag(handle, {
      x: handle.x - (sideways ? shrink : 0),
      y: handle.y - (sideways ? 0 : shrink),
    });
    const after = outlineBox();
    if (sideways) {
      expectClose(after.x, moved.x);
      expectClose(after.width, moved.width - shrink, 3);
    } else {
      expectClose(after.y, moved.y);
      expectClose(after.height, moved.height - shrink, 3);
    }
    expectOneCommit(edits, "resize");
  });
});

describe("rotating", () => {
  test("the zone just outside a corner rotates the layer about its origin", async () => {
    const edits = await renderMonitor();
    const overlay = byTestId("preview-transform-overlay");
    const monitor = overlay.getBoundingClientRect();
    const video = videoRect();
    expect(byTestId("preview-rotation-handle")).toBeTruthy();

    // Just outside the bottom-right corner, in the letterbox bar beside or
    // below the video, is a rotate zone.
    const inPillarbox = video.left - monitor.x > 20;
    expect(inPillarbox || video.top - monitor.y > 20).toBe(true);
    const corner = {
      x: video.left + video.width,
      y: video.top + video.height,
    };
    const zone = inPillarbox
      ? { x: corner.x + 12, y: corner.y - 8 }
      : { x: corner.x - 8, y: corner.y + 12 };
    await mouseMove(zone);
    expect(getComputedStyle(overlay).cursor).toMatch(/url\(/);
    await dragAround(zone, outlineCenter(), 30);
    expect(readout()?.textContent).toBe("30°");
    await mouseUp();
    expect(readout()).toBeNull();
    expect(outlineRotation()).toBeCloseTo(30, 1);
    expectOneCommit(edits, "rotate");
  });

  test("the rotation handle turns the layer past the video edge and settles on a right angle", async () => {
    const edits = await renderMonitor();
    const monitor = byTestId(
      "preview-transform-overlay",
    ).getBoundingClientRect();
    const video = videoRect();
    // Move the layer so its rotation handle, above the middle of its top
    // edge, sits in the letterbox bar outside the video: beside it in a
    // pillarbox; in a letterbox it already sits above the video.
    const centered = outlineCenter();
    const start = { x: centered.x, y: centered.y + video.height / 8 };
    const pillarbox = video.left - monitor.x;
    if (pillarbox > 20) {
      await drag(start, {
        x: start.x + video.width / 2 + pillarbox / 2,
        y: start.y + video.height / 4,
      });
      edits.length = 0;
    }
    const origin = outlineCenter();
    const handle = centerOf("preview-rotation-handle");
    expect(
      handle.x > video.left + video.width || handle.y < video.top,
    ).toBeTruthy();

    // Dragging the handle from above the layer's center to beside it is a
    // quarter turn, which settles exactly on 90 degrees.
    expect(getComputedStyle(byTestId("preview-rotation-handle")).cursor).toMatch(
      /url\(/,
    );
    await dragAround(handle, origin, 88.5);
    expect(readout()?.textContent).toBe("90°");
    await mouseUp();
    expect(outlineRotation()).toBeCloseTo(90, 1);
    expectOneCommit(edits, "rotate");
  });

  test("Shift snaps the handle to 15 degree steps and a double-click straightens", async () => {
    const edits = await renderMonitor();
    const video = videoRect();
    // Move the layer down, so its handle stays on the monitor as it turns.
    const centered = outlineCenter();
    const start = { x: centered.x, y: centered.y + video.height / 8 };
    await drag(start, { x: start.x, y: start.y + video.height / 4 });
    edits.length = 0;
    const lowered = outlineCenter();

    // With Shift, 41 degrees is 45.
    await key("keyDown", SHIFT_KEY);
    await dragAround(centerOf("preview-rotation-handle"), lowered, 41);
    expect(readout()?.textContent).toBe("45°");
    await mouseUp();
    await key("keyUp", SHIFT_KEY);
    expect(outlineRotation()).toBeCloseTo(45, 1);
    expectOneCommit(edits, "rotate");

    // Double-clicking the handle straightens the layer.
    await doubleClick(centerOf("preview-rotation-handle"));
    await expect
      .poll(() => Math.abs(outlineRotation()))
      .toBeLessThan(0.01);
  });
});
