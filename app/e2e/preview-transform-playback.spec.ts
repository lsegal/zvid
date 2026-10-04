import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// While playing, the preview's selection box follows an animating layer on
// every frame, as the compositor draws it, instead of stepping at playhead
// commits (#1013).
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

test("the selection box tracks an animating layer during playback", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Turn Animation Off for Order" })
    .click();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });

  // A Transform on the layer whose LFO swings its scale twice a second.
  const layerHeader = page.locator('[data-layer-header-id="1"]');
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name: /^Transform/ })
    .click();
  const animation = page.locator('section[aria-label="Transform animation"]');
  await animation
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "LFO" })
    .click();
  await animation
    .getByRole("group", { name: "Sync" })
    .getByRole("button", { name: "Off" })
    .click();

  // Selecting the layer outlines its box.
  await layerHeader.click();
  const outline = page.getByTestId("preview-transform-outline");
  await expect(outline).toHaveCount(1);

  await page.getByRole("button", { name: "Play timeline" }).click();
  // Sample the box several times within a quarter second: one playhead
  // commit's span. Following the commits, the box would hold still.
  const widths = new Set<number>();
  for (let sample = 0; sample < 6; sample += 1) {
    const box = await outline.boundingBox();
    widths.add(Math.round((box?.width ?? 0) * 10));
    await page.waitForTimeout(40);
  }
  await page.getByRole("button", { name: "Pause playback" }).click();
  expect(widths.size).toBeGreaterThanOrEqual(3);
});
