import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The selected layer's rotation handle, and the zones just outside its
// corners, rotate it about its origin as one undo step, with a live angle
// readout. Shift snaps to 15 degrees and double-clicking the handle resets.
// Like the outline, they work past the edge of the video.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

type Point = { x: number; y: number };

async function dropVideoIntoNewSourceTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// The letterboxed video inside the monitor, in page coordinates.
async function videoRect(page: Page) {
  return page.locator(".composition-player__canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    const element = canvas as HTMLCanvasElement;
    const fit = Math.min(
      bounds.width / element.width,
      bounds.height / element.height,
    );
    const width = element.width * fit;
    const height = element.height * fit;
    return {
      left: bounds.left + (bounds.width - width) / 2,
      top: bounds.top + (bounds.height - height) / 2,
      width,
      height,
    };
  });
}

// The outline's corners in page coordinates, clockwise from the top-left.
async function outlineCorners(page: Page) {
  const outline = page.getByTestId("preview-transform-outline");
  const points = await outline.getAttribute("points");
  const monitor = await page
    .getByTestId("preview-transform-overlay")
    .boundingBox();
  return (points ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x + (monitor?.x ?? 0), y: y + (monitor?.y ?? 0) };
    });
}

// The outline's rotation, from its top edge: 0 when level, positive
// clockwise.
async function outlineRotation(page: Page) {
  const [topLeft, topRight] = await outlineCorners(page);
  return (
    (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) / Math.PI
  );
}

// The middle of the outline, which is the layer's default origin.
async function outlineCenter(page: Page): Promise<Point> {
  const corners = await outlineCorners(page);
  return {
    x: corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length,
    y: corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length,
  };
}

async function handleCenter(page: Page): Promise<Point> {
  const box = await page.getByTestId("preview-rotation-handle").boundingBox();
  if (!box) {
    throw new Error("rotation handle is not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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

async function dragAround(
  page: Page,
  from: Point,
  origin: Point,
  degrees: number,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    const to = turn(from, origin, (degrees * step) / 6);
    await page.mouse.move(to.x, to.y);
  }
}

async function expectUndo(page: Page, label: RegExp) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const undo = page.getByRole("menuitem", { name: /^Undo/ });
  await expect(undo).toHaveText(label);
  return undo;
}

test("the preview rotates a layer with its handle and corner zones", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });

  const overlay = page.getByTestId("preview-transform-overlay");
  const readout = page.getByTestId("preview-rotation-readout");
  const transform = page.getByRole("region", {
    name: "Transform",
    exact: true,
  });
  const monitor = await overlay.boundingBox();
  const video = await videoRect(page);
  if (!monitor) {
    throw new Error("preview monitor is not visible");
  }
  const center = {
    x: video.left + video.width / 2,
    y: video.top + video.height / 2,
  };

  // Select the layer; it fills the video, so its corners are the video's.
  await page.mouse.click(center.x, center.y);
  await expect(page.getByTestId("preview-rotation-handle")).toHaveCount(1);

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
  await page.mouse.move(zone.x, zone.y);
  await expect(overlay).toHaveCSS("cursor", /url\(/);
  // Adding the Transform shows it in the FX panel, which can resize the
  // monitor mid-drag; the angle is measured from where the drag began, so it
  // still follows the pointer.
  await dragAround(page, zone, await outlineCenter(page), 30);
  await expect(readout).toHaveText("30°");
  await page.mouse.up();
  await expect(readout).toHaveCount(0);
  expect(await outlineRotation(page)).toBeCloseTo(30, 1);
  await expect(transform).toHaveCount(1);

  // The rotation, including adding the Transform, is one undo step.
  const undo = await expectUndo(page, /^Undo Rotate test-pattern/);
  await undo.click();
  await expect(transform).toHaveCount(0);
  expect(await outlineRotation(page)).toBeCloseTo(0, 1);

  // Nudge the layer so it has a Transform and the layout settles, then move
  // it so its rotation handle, above the middle of its top edge, sits in the
  // letterbox bar outside the video.
  await page.mouse.click(center.x, center.y);
  await page.keyboard.press("ArrowDown");
  await expect(transform).toHaveCount(1);
  const settledMonitor = await overlay.boundingBox();
  const settled = await videoRect(page);
  if (!settledMonitor) {
    throw new Error("preview monitor is not visible");
  }
  // Grab the layer below its center, clear of the origin marker there.
  const centered = await outlineCenter(page);
  const start = { x: centered.x, y: centered.y + settled.height / 8 };
  const pillarbox = settled.left - settledMonitor.x;
  const offset =
    pillarbox > 20
      ? { x: settled.width / 2 + pillarbox / 2, y: settled.height / 4 }
      : { x: 0, y: 0 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + offset.x, start.y + offset.y, {
    steps: 6,
  });
  await page.mouse.up();
  const origin = await outlineCenter(page);
  const handle = await handleCenter(page);
  expect(
    handle.x > settled.left + settled.width || handle.y < settled.top,
  ).toBeTruthy();

  // Dragging the handle from above the layer's center to beside it is a
  // quarter turn, which settles exactly on 90 degrees.
  await expect(page.getByTestId("preview-rotation-handle")).toHaveCSS(
    "cursor",
    /url\(/,
  );
  await dragAround(page, handle, origin, 88.5);
  await expect(readout).toBeVisible();
  await expect(readout).toHaveText("90°");
  await page.mouse.up();
  expect(await outlineRotation(page)).toBeCloseTo(90, 1);
  await (await expectUndo(page, /^Undo Rotate test-pattern/)).click();
  expect(await outlineRotation(page)).toBeCloseTo(0, 1);
  await (await expectUndo(page, /^Undo Move test-pattern/)).click();

  // Move the layer down instead, so its handle stays on the monitor as it
  // turns. With Shift, the handle snaps to 15 degree steps: 41 is 45.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + settled.height / 4, { steps: 6 });
  await page.mouse.up();
  const lowered = await outlineCenter(page);
  await page.keyboard.down("Shift");
  await dragAround(page, await handleCenter(page), lowered, 41);
  await expect(readout).toHaveText("45°");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect(await outlineRotation(page)).toBeCloseTo(45, 1);

  // Double-clicking the handle straightens the layer.
  const last = await handleCenter(page);
  await page.mouse.dblclick(last.x, last.y);
  await expect
    .poll(async () => Math.abs(await outlineRotation(page)))
    .toBeLessThan(0.01);
});
