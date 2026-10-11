import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// Stays in Playwright: these tests read the preview the wasm compositor
// draws in the running app. The Hide switch on each layer and source track
// header (#1026) hides the track in the preview, and a hidden Mask Target
// keeps its box there. How the compositor treats a hidden layer is covered
// in src/CompositionPlayer.hidden-layers.component.test.tsx, and the
// switches themselves in TrackHideButton.component.test.tsx.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function header(page: Page, id: string) {
  return page.locator(`[data-layer-header-id="${id}"]`);
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a fill clip on layer `laneId`, selected, and moves the playhead
// to its middle, where it is fully drawn.
async function insertFillAtStart(page: Page, laneId: string) {
  const bounds = await lane(page, laneId).boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, y, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" })
    .click();
  const fill = lane(page, laneId).locator(".clip-card--fill");
  await expect(fill).toHaveClass(/clip-card--selected/);
  const clip = await fill.boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
  await expect(fill).toHaveClass(/clip-card--selected/);
}

// The preview's color a third of the way across and a quarter of the way down,
// inside the source test pattern's magenta bar at any monitor height (a
// quarter of the way across falls in the letterbox beside it on a short
// monitor). Read from a screenshot so the WebGL canvas needn't keep its
// drawing buffer.
async function previewColor(page: Page) {
  const png = await page
    .locator(".composition-player__canvas")
    .screenshot({ animations: "disabled" });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D context");
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(
      Math.floor(image.width / 3),
      Math.floor(image.height / 4),
      1,
      1,
    ).data;
    return [pixel[0], pixel[1], pixel[2]];
  }, png.toString("base64"));
}

function difference(left: number[], right: number[]) {
  return Math.max(
    ...left.map((value, index) => Math.abs(value - right[index])),
  );
}

async function expectPreview(page: Page, expected: number[]) {
  await expect
    .poll(async () => difference(await previewColor(page), expected))
    .toBeLessThan(8);
}

test("the eye left of a layer's FX switch hides it in the preview, undoably", async ({
  page,
}) => {
  await insertFillAtStart(page, "1");
  await page.mouse.move(0, 0);
  const filled = await previewColor(page);

  const eye = header(page, "1").locator(".track-label__hide");
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expect(eye).toHaveAttribute("title", "Hide Layer 1");
  // It sits just left of the FX switch.
  const fx = header(page, "1").locator(".track-label__fx");
  const eyeBox = await eye.boundingBox();
  const fxBox = await fx.boundingBox();
  expect(eyeBox && fxBox && eyeBox.x + eyeBox.width <= fxBox.x + 1).toBe(true);

  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expect(eye).toHaveAttribute("title", "Show Layer 1");
  await expect(header(page, "1")).toContainText("Hidden");
  // Clicking the eye doesn't select the layer instead of the clip.
  await expect(lane(page, "1").locator(".clip-card--fill")).toHaveClass(
    /clip-card--selected/,
  );
  await page.mouse.move(0, 0);
  // Whatever is beneath the fill shows instead.
  await expect
    .poll(async () => difference(await previewColor(page), filled))
    .toBeGreaterThan(32);
  const hidden = await previewColor(page);

  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expect(header(page, "1")).not.toContainText("Hidden");
  await page.mouse.move(0, 0);
  await expectPreview(page, filled);

  // Each toggle is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expectPreview(page, hidden);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expectPreview(page, filled);
});

test("a source track's eye hides its video in the preview", async ({
  page,
}) => {
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceVideo(page);
  // With no layer clips, the preview renders the source tracks.
  await expect(page.locator(".preview-monitor")).toHaveAttribute(
    "data-render-source",
    "source-tracks",
  );
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  const label = page.locator(".track-label--source");
  const eye = label.locator(".track-label__hide");
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await page.mouse.move(0, 0);
  const shown = await previewColor(page);

  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expect(eye).toHaveAttribute("title", "Show test-pattern");
  await expect(label).toContainText("Hidden");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(await previewColor(page), shown))
    .toBeGreaterThan(32);

  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expect(label).not.toContainText("Hidden");
  await page.mouse.move(0, 0);
  await expectPreview(page, shown);
});

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// Drops the test pattern into a new source track.
async function addSourceVideo(page: Page) {
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

// The page color at a point, read from a one-pixel screenshot.
async function colorAt(page: Page, x: number, y: number) {
  const png = await page.screenshot({
    clip: { x, y, width: 1, height: 1 },
    animations: "disabled",
  });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D context");
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2]];
  }, png.toString("base64"));
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

async function addLayerFx(page: Page, laneId: string, name: RegExp) {
  await header(page, laneId).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name })
    .click();
}

// Tall enough to show Layer 2 below Layer 1 in the timeline.
test.describe(() => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  test("a hidden Mask Target keeps its box in the preview, and dragging it moves the mask (#1030)", async ({
    page,
  }) => {
    // A new session's Order slides each layer in as its clip starts; hold it
    // still so the layers are in place at the playhead.
    await page
      .getByRole("button", { name: "Turn Animation Off for Order" })
      .click();
    await addLayers(page, 1);
    await insertFillAtStart(page, "2");
    await insertFillAtStart(page, "1");
    // Layer 2 (lane 2) is a Shape, a centered square, hidden; Layer 1 cuts it out.
    await addLayerFx(page, "2", /^Shape/);
    await header(page, "2").locator(".track-label__hide").click();
    await expect(header(page, "2")).toContainText("Hidden");
    await addLayerFx(page, "1", /^Mask/);
    const mask = page.locator('section[aria-label="Mask"]');
    await mask.getByRole("button", { name: "Target" }).click();
    await page.getByRole("menuitemcheckbox", { name: /Layer 2/ }).click();
    await mask.getByRole("button", { name: "Subtractive" }).click();

    const video = await videoRect(page);
    const at = (x: number, y: number) => ({
      x: video.left + video.width * x,
      y: video.top + video.height * y,
    });
    const sample = async (x: number, y: number) => {
      const point = at(x, y);
      return colorAt(page, point.x, point.y);
    };
    await page.mouse.move(0, 0);
    // The square cuts a hole in Layer 1, but draws nothing there itself.
    // The samples keep clear of the origin marker at the box's center.
    await expect
      .poll(async () =>
        difference(await sample(0.42, 0.55), await sample(0.85, 0.55)),
      )
      .toBeGreaterThan(32);
    const filled = await sample(0.85, 0.55);
    const hole = await sample(0.42, 0.55);

    // Selecting the hidden layer's clip outlines its box.
    const outline = page.getByTestId("preview-transform-outline");
    await lane(page, "2").locator(".clip-card--fill").click();
    await expect(outline).toHaveCount(1);

    // Dragging it, clear of the origin marker, moves the hole.
    const grab = at(0.5, 0.35);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + video.width * 0.15, grab.y, { steps: 4 });
    await page.mouse.move(grab.x + video.width * 0.3, grab.y, { steps: 4 });
    await page.mouse.up();
    await expect(
      page.getByRole("region", { name: "Transform", exact: true }),
    ).toHaveCount(2);
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => difference(await sample(0.42, 0.55), filled))
      .toBeLessThan(8);
    // The moved square still draws nothing.
    expect(difference(await sample(0.75, 0.6), hole)).toBeLessThan(8);
  });
});
