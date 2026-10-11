import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// Stays in Playwright: it checks the drags against the FX panel, the Edit
// menu's undo history and clipboard, and the timeline's layer headers.
// PreviewTransformOverlay.component.test.tsx covers the overlay's own drags.
//
// Clicking a layer in the preview selects and outlines its clip, and dragging
// it writes the clip's own Transform effect as one undo step; with only the
// layer selected, a drag writes the layer's Transform. The outline is drawn
// over the whole monitor, so it stays visible past the edge of the video.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// A new session's Order slides each layer in as its clip starts, so at the
// playhead a clip was just placed at the layer isn't there yet. These tests
// need it in place, so they turn that animation off.
async function holdOrderStill(page: Page) {
  await page
    .getByRole("button", { name: "Turn Animation Off for Order" })
    .click();
  await expect(
    page.getByRole("button", { name: "Turn Animation On for Order" }),
  ).toHaveAttribute("aria-pressed", "false");
}

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

test("the preview selects, outlines and drags a layer", async ({ page }) => {
  await page.goto("/");
  await holdOrderStill(page);
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });

  const overlay = page.getByTestId("preview-transform-overlay");
  const outline = page.getByTestId("preview-transform-outline");

  // A click on empty monitor space, outside the video, clears the outline.
  const monitor = await overlay.boundingBox();
  const video = await videoRect(page);
  if (!monitor) {
    throw new Error("preview monitor is not visible");
  }
  // The monitor has rounded corners, so click in the middle of a letterbox
  // bar instead.
  const barX = (monitor.x + video.left) / 2;
  const barY = (monitor.y + video.top) / 2;
  const inPillarbox = video.left - monitor.x > 8;
  expect(inPillarbox || video.top - monitor.y > 8).toBe(true);
  await page.mouse.click(
    inPillarbox ? barX : video.left + video.width / 2,
    inPillarbox ? video.top + video.height / 2 : barY,
  );
  await expect(outline).toHaveCount(0);

  // Clicking the layer selects and outlines it.
  const center = {
    x: video.left + video.width / 2,
    y: video.top + video.height / 2,
  };
  await page.mouse.click(center.x, center.y);
  await expect(outline).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(0);

  // Dragging it most of the way out of frame adds a Transform to the clip's
  // own stack. The grab is off-center, clear of the origin marker.
  const grab = { x: center.x, y: video.top + video.height * 0.25 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + video.width * 0.3, grab.y, { steps: 4 });
  await page.mouse.move(grab.x + video.width * 0.75, grab.y, {
    steps: 4,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator('[data-fx-divider="clip"]')).toBeVisible();

  // The outline is still drawn where the layer leaves the video.
  const box = await outline.boundingBox();
  expect(box?.x ?? 0).toBeGreaterThan(video.left + video.width * 0.5);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(
    video.left + video.width + 10,
  );

  // The move, including adding the Transform, is one undo step.
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const undo = page.getByRole("menuitem", { name: /^Undo/ });
  await expect(undo).toHaveText(/^Undo Move test-pattern/);
  await undo.click();
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(0);
  const restored = await outline.boundingBox();
  expect(restored?.x ?? 0).toBeLessThanOrEqual(video.left + 1);

  // Esc in the focused preview clears the selection.
  await page.mouse.click(center.x, center.y);
  await expect(outline).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(outline).toHaveCount(0);

  // With only the layer selected, a drag moves the layer's Transform, and
  // the panel shows no Clip section.
  await page
    .locator(".track-label--lane")
    .filter({ hasText: "Layer 1" })
    .locator(".track-label__index")
    .click();
  await expect(outline).toHaveCount(1);
  await expect(page.locator('[data-fx-divider="clip"]')).toHaveCount(0);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + video.width * 0.2, grab.y, { steps: 4 });
  await page.mouse.up();
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Undo/ })).toHaveText(
    /^Undo Move Layer 1/,
  );
  await page.keyboard.press("Escape");
});

test("a clip's own Transform follows Duplicate and Paste", async ({ page }) => {
  await page.goto("/");
  await holdOrderStill(page);
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await addLayers(page, 1);
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });

  const video = await videoRect(page);
  const grab = {
    x: video.left + video.width / 2,
    y: video.top + video.height * 0.25,
  };
  await page.mouse.click(grab.x, grab.y);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + video.width * 0.2, grab.y, { steps: 4 });
  await page.mouse.up();
  const transform = page.getByRole("region", {
    name: "Transform",
    exact: true,
  });
  await expect(transform).toHaveCount(1);

  const editMenu = async () => {
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("menu").first()).toBeVisible();
  };

  // The duplicate is selected, with its own copy of the Transform.
  await editMenu();
  await page.getByRole("menuitem", { name: /^Clip: / }).hover();
  await page.getByRole("menuitem", { name: /^Duplicate/ }).click();
  const clips = page.locator(".clip-card");
  await expect(clips).toHaveCount(2);
  await expect(clips.nth(1)).toHaveClass(/clip-card--selected/);
  await expect(transform).toHaveCount(1);

  // Copied and pasted on Layer 2, the clip keeps it too.
  await editMenu();
  await page.getByRole("menuitem", { name: /^Copy/ }).click();
  await page
    .locator(".track-label--lane")
    .filter({ hasText: "Layer 2" })
    .locator(".track-label__index")
    .click();
  await expect(transform).toHaveCount(0);
  await editMenu();
  await page.getByRole("menuitem", { name: /^Paste/ }).click();
  const pasted = page.locator('[data-timeline-lane-id="2"] .clip-card');
  await expect(pasted).toHaveClass(/clip-card--selected/);
  await expect(transform).toHaveCount(1);
});

// The outline's corners in page coordinates, clockwise from the top-left.
async function outlineCorners(page: Page) {
  const points = await page
    .getByTestId("preview-transform-outline")
    .getAttribute("points");
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

async function outlineWidth(page: Page) {
  const [topLeft, topRight] = await outlineCorners(page);
  return Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
}

// The outline's rotation, from its top edge: 0 when level, positive
// clockwise.
async function outlineRotation(page: Page) {
  const [topLeft, topRight] = await outlineCorners(page);
  return (
    (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) / Math.PI
  );
}

async function centerOf(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) {
    throw new Error(`${testId} is not visible`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function undoLast(page: Page, label: RegExp) {
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const undo = page.getByRole("menuitem", { name: /^Undo/ });
  await expect(undo).toHaveText(label);
  await undo.click();
}

// PreviewTransformOverlay.component.test.tsx checks that each of these
// drags commits one edit; this checks the app turns each into one named
// undo step.
test("a resize, a rotation and an origin move are each one undo step", async ({
  page,
}) => {
  await page.goto("/");
  await holdOrderStill(page);
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  const transform = page.getByRole("region", {
    name: "Transform",
    exact: true,
  });
  const video = await videoRect(page);
  await page.mouse.click(
    video.left + video.width / 2,
    video.top + video.height / 2,
  );
  await expect(page.locator("[data-transform-handle]")).toHaveCount(8);
  const width = await outlineWidth(page);

  // The layer fills the frame's height, so the corner handle's center sits
  // on the monitor's clipped bottom edge; grab it a little inside.
  const handle = await centerOf(page, "preview-transform-handle-se");
  const corner = { x: handle.x - 3, y: handle.y - 3 };
  await drag(page, corner, {
    x: corner.x - video.width * 0.25,
    y: corner.y - video.height * 0.25,
  });
  expect(await outlineWidth(page)).toBeLessThan(width * 0.9);
  await expect(transform).toHaveCount(1);
  // The resize, including adding the Transform, is one undo step.
  await undoLast(page, /^Undo Resize test-pattern/);
  await expect(transform).toHaveCount(0);
  expect(Math.abs((await outlineWidth(page)) - width)).toBeLessThanOrEqual(2);

  // Just outside the bottom-right corner, in the letterbox bar, rotates.
  const monitor = await page
    .getByTestId("preview-transform-overlay")
    .boundingBox();
  if (!monitor) {
    throw new Error("preview monitor is not visible");
  }
  const inPillarbox = video.left - monitor.x > 20;
  const bottomRight = {
    x: video.left + video.width,
    y: video.top + video.height,
  };
  const zone = inPillarbox
    ? { x: bottomRight.x + 12, y: bottomRight.y - 8 }
    : { x: bottomRight.x - 8, y: bottomRight.y + 12 };
  await drag(page, zone, {
    x: zone.x - video.width * 0.2,
    y: zone.y + video.height * 0.2,
  });
  expect(Math.abs(await outlineRotation(page))).toBeGreaterThan(5);
  await undoLast(page, /^Undo Rotate test-pattern/);
  await expect(transform).toHaveCount(0);
  expect(await outlineRotation(page)).toBeCloseTo(0, 1);

  const origin = await centerOf(page, "preview-transform-origin");
  await drag(page, origin, {
    x: video.left + video.width * 0.8,
    y: video.top + video.height * 0.3,
  });
  await undoLast(page, /^Undo Move origin/);
  const restored = await centerOf(page, "preview-transform-origin");
  expect(Math.abs(restored.x - origin.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(restored.y - origin.y)).toBeLessThanOrEqual(2);
});
