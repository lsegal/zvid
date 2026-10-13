import { useRef, useState } from "react";
import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { mouse } from "../component-test/mouse.ts";
import { resolveVisualState } from "../composition-active-clips.ts";
import { resolveCanvasBounds } from "../composition-layout.ts";
import {
  IDENTITY_TRANSFORM,
  parseLayerMove,
} from "../composition-transform.ts";
import { readMovePoint } from "../fx/effects/move/move-point-selection.ts";
import { clipEffectTrackId } from "../fx-stack.ts";
import type { PreviewLayer } from "../preview-edit.ts";
import { type PreviewMoveEdit, PreviewMovePath } from "./PreviewMovePath";

// The selected clip's Move path on the preview: its dots sit where the clip
// is drawn at each point, dragging one moves that point, clicking the path
// adds a waypoint there, right-clicking a waypoint removes it, and the
// fifth waypoint is refused with a hint.
//
// The clip fills a 1920x1080 canvas, letterboxed into an 800x600 monitor:
// 2.4 canvas pixels per CSS pixel, the video 75px below the monitor's top.
const CANVAS = { width: 1920, height: 1080 };
const MONITOR = { width: 800, height: 600 };
const SCALE = 2.4;
const MOVE_ID = "move-1";

type Values = Record<string, number | string>;

function layerFor(values: Values): PreviewLayer {
  const visual = resolveVisualState(
    [
      {
        id: MOVE_ID,
        trackId: clipEffectTrackId("clip-1"),
        effectName: "Move",
        parameters: Object.entries(values).map(([key, value]) => ({
          key,
          value: String(value),
        })),
      },
    ],
    "1",
    "clip-1",
    0,
  );
  return {
    laneId: "1",
    clipId: "clip-1",
    placement: { frame: resolveCanvasBounds(CANVAS.width, CANVAS.height) },
    transform: IDENTITY_TRANSFORM,
    clipTransform: IDENTITY_TRANSFORM,
    ...(visual.clipMotion && { clipMotion: visual.clipMotion }),
    ...(visual.moves && { moves: visual.moves }),
    corners: [
      { x: 0, y: 0 },
      { x: 1920, y: 0 },
      { x: 1920, y: 1080 },
      { x: 0, y: 1080 },
    ],
  };
}

// The path over a selected clip, applying its edits to the Move as the app
// does, and recording them in `edits`.
function Monitor({
  initial,
  edits,
}: {
  initial: Values;
  edits: PreviewMoveEdit[];
}) {
  const [values, setValues] = useState(initial);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  return (
    <div
      data-testid="monitor"
      style={{
        position: "relative",
        margin: 40,
        width: MONITOR.width,
        height: MONITOR.height,
      }}
    >
      <PreviewMovePath
        canvas={CANVAS}
        layers={[layerFor(values)]}
        selectedLaneId="1"
        selectedClipId="clip-1"
        editing={{
          getMove: () =>
            parseLayerMove(
              Object.entries(valuesRef.current).map(([key, value]) => ({
                key,
                value: String(value),
              })),
            ),
          onEdit: (edit) => {
            edits.push(edit);
            setValues((current) => ({ ...current, ...edit.values }));
          },
        }}
      />
    </div>
  );
}

async function renderMonitor(initial: Values) {
  const edits: PreviewMoveEdit[] = [];
  await render(<Monitor initial={initial} edits={edits} />);
  return edits;
}

function dot(point: string | number) {
  return document.querySelector<HTMLElement>(
    `[data-testid="preview-move-point-${point}"]`,
  );
}

// A dot's center relative to the monitor's top-left corner.
function dotCenter(point: string | number) {
  const element = dot(point);
  if (!element) {
    throw new Error(`No ${point} dot`);
  }
  const box = element.getBoundingClientRect();
  const monitor = document
    .querySelector('[data-testid="monitor"]')
    ?.getBoundingClientRect();
  return {
    x: box.x + box.width / 2 - (monitor?.x ?? 0),
    y: box.y + box.height / 2 - (monitor?.y ?? 0),
  };
}

function monitorOrigin() {
  const box = document
    .querySelector('[data-testid="monitor"]')
    ?.getBoundingClientRect();
  return { x: box?.x ?? 0, y: box?.y ?? 0 };
}

async function clickAt(x: number, y: number, button?: "right") {
  const origin = monitorOrigin();
  await mouse.click(origin.x + x, origin.y + y, { button });
}

describe("PreviewMovePath", () => {
  test("draws Start and End where the clip is drawn there, and the path between", async () => {
    await renderMonitor({ StartPositionX: -0.25, EndPositionY: 0.25 });
    await expect.poll(() => dot("start")).not.toBeNull();

    // Start: a quarter canvas left of center; End: a quarter canvas down.
    expect(dotCenter("start")).toEqual({ x: 200, y: 300 });
    expect(dotCenter("end")).toEqual({ x: 400, y: 412.5 });
    expect(dot(1)).toBeNull();
    const line = document.querySelector(
      '[data-testid="preview-move-path-line"]',
    );
    expect(line?.getAttribute("points")?.split(" ").at(0)).toBe("200,300");
    expect(line?.getAttribute("points")?.split(" ").at(-1)).toBe("400,412.5");
  });

  test("dragging a dot moves that point live, then commits once", async () => {
    const edits = await renderMonitor({ StartPositionX: -0.25 });
    await expect.poll(() => dot("end")).not.toBeNull();
    const origin = monitorOrigin();

    await mouse.move(origin.x + 400, origin.y + 300);
    await mouse.down();
    await mouse.move(origin.x + 500, origin.y + 350, { steps: 5 });
    await mouse.up();

    await expect.poll(() => dotCenter("end")).toEqual({ x: 500, y: 350 });
    const last = edits.at(-1);
    expect(last?.mode).toBe("commit");
    expect(edits.at(-2)?.mode).toBe("transient");
    expect(edits.at(-2)?.values.EndPositionX).toBeCloseTo(
      (100 * SCALE) / CANVAS.width,
    );
    expect(edits.at(-2)?.values.EndPositionY).toBeCloseTo(
      (50 * SCALE) / CANVAS.height,
    );
    expect(readMovePoint(MOVE_ID)).toBe("end");
  });

  test("clicking the path adds a waypoint there, and right-clicking removes it", async () => {
    const edits = await renderMonitor({ StartPositionX: -0.25 });
    await expect.poll(() => dot("start")).not.toBeNull();

    await clickAt(350, 300);
    await expect.poll(() => dot(1)).not.toBeNull();
    expect(dotCenter(1).x).toBeCloseTo(350, 0);
    expect(dotCenter(1).y).toBeCloseTo(300, 0);
    expect(edits.at(-1)).toMatchObject({
      mode: "commit",
      values: { Waypoints: "1" },
    });
    expect(readMovePoint(MOVE_ID)).toBe(1);

    const center = dotCenter(1);
    await clickAt(center.x, center.y, "right");
    await expect.poll(() => dot(1)).toBeNull();
    expect(edits.at(-1)).toMatchObject({ values: { Waypoints: "0" } });
    expect(readMovePoint(MOVE_ID)).toBe("start");
  });

  test("refuses a fifth waypoint with a hint", async () => {
    const edits = await renderMonitor({
      Path: "Lines",
      Waypoints: "4",
      StartPositionX: -0.25,
      Point1PositionX: -0.2,
      Point2PositionX: -0.15,
      Point3PositionX: -0.1,
      Point4PositionX: -0.05,
    });
    await expect.poll(() => dot(4)).not.toBeNull();
    const count = edits.length;

    // Between waypoint 4 and the End.
    await clickAt(390, 300);
    await expect
      .poll(() => document.querySelector('[role="status"]')?.textContent)
      .toBe("A Move has at most 4 waypoints");
    expect(edits.length).toBe(count);
  });
});
