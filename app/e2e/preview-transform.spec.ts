import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Clicking a layer in the preview selects and outlines it, and dragging it
// writes its Transform effect as one undo step. The outline is drawn over the
// whole monitor, so it stays visible past the edge of the video.
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

test("the preview selects, outlines and drags a layer", async ({ page }) => {
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
  const centre = {
    x: video.left + video.width / 2,
    y: video.top + video.height / 2,
  };
  await page.mouse.click(centre.x, centre.y);
  await expect(outline).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(0);

  // Dragging it most of the way out of frame adds a Transform. The grab is
  // off-centre, clear of the origin marker.
  const grab = { x: centre.x, y: video.top + video.height * 0.25 };
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

  // The outline is still drawn where the layer leaves the video.
  const box = await outline.boundingBox();
  expect(box?.x ?? 0).toBeGreaterThan(video.left + video.width * 0.5);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(
    video.left + video.width + 10,
  );

  // The move, including adding the Transform, is one undo step.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const undo = page.getByRole("menuitem", { name: /^Undo/ });
  await expect(undo).toHaveText(/^Undo Move Layer 1/);
  await undo.click();
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(0);
  const restored = await outline.boundingBox();
  expect(restored?.x ?? 0).toBeLessThanOrEqual(video.left + 1);

  // Esc in the focused preview clears the selection.
  await page.mouse.click(centre.x, centre.y);
  await expect(outline).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(outline).toHaveCount(0);
});
