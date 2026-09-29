import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// A clip Ctrl/Cmd-dragged to duplicate it is drawn with its source clip's
// stack while it is dragged, as it is once dropped, instead of jumping to
// its clip Transform on release.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

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

// Tall enough to show the layers the clip is dragged between.
test.use({ viewport: { width: 1600, height: 1400 } });

// The selected layer's outline, as fractions of the video, which the
// monitor may lay out differently once the drag ends.
async function outlineBox(page: Page) {
  const box = await page.getByTestId("preview-transform-outline").boundingBox();
  if (!box) {
    throw new Error("preview outline is not visible");
  }
  const video = await videoRect(page);
  return {
    x: (box.x - video.left) / video.width,
    y: (box.y - video.top) / video.height,
    width: box.width / video.width,
    height: box.height / video.height,
  };
}

test("a Ctrl/Cmd-drag duplicate keeps its clip Transform during the drag", async ({
  page,
}) => {
  await page.goto("/");
  const lanes = page.locator("[data-timeline-lane-id]");
  await expect(lanes.nth(1)).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });

  // Dragging the layer in the preview gives the clip its own Transform,
  // moving it right.
  const video = await videoRect(page);
  const grab = {
    x: video.left + video.width / 2,
    y: video.top + video.height * 0.25,
  };
  await page.mouse.click(grab.x, grab.y);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + video.width * 0.1, grab.y, { steps: 4 });
  await page.mouse.move(grab.x + video.width * 0.2, grab.y, { steps: 4 });
  await page.mouse.up();
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(1);

  // Ctrl/Cmd-drag the clip down to the next layer, at the same time.
  // Grab the body, clear of the trim handles.
  const body = lanes.nth(0).locator(".clip-card .clip-card__body");
  const clipBounds = await body.boundingBox();
  const targetLane = await lanes.nth(1).boundingBox();
  if (!clipBounds || !targetLane) {
    throw new Error("timeline is not visible");
  }
  const start = {
    x: clipBounds.x + clipBounds.width / 2,
    y: clipBounds.y + clipBounds.height / 2,
  };
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, targetLane.y + targetLane.height / 2, {
    steps: 6,
  });
  await expect(lanes.nth(1).locator(".clip-card")).toHaveCount(1);

  // The copy is selected, and its outline sits where its Transform puts it.
  const during = await outlineBox(page);
  const monitor = page.locator(".preview-monitor");
  await monitor.screenshot({ path: test.info().outputPath("during-drag.png") });

  await page.mouse.up();
  await page.keyboard.up("ControlOrMeta");
  await expect(lanes.nth(0).locator(".clip-card")).toHaveCount(1);
  await expect(lanes.nth(1).locator(".clip-card")).toHaveCount(1);
  // The copy got its own stack on the drop.
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(1);

  const after = await outlineBox(page);
  await monitor.screenshot({ path: test.info().outputPath("after-drop.png") });
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(during[key] - after[key]), key).toBeLessThan(0.01);
  }
});
