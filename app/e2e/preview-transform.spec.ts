import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

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
