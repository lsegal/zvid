import { expect, type Page, test } from "@playwright/test";

// The FX button in each layer header (#693): always toggleable, lit while
// the layer's FX are on, and turning it off turns off every effect on the
// layer, its clips' included.

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

// The preview's color a quarter of the way in from its top-left corner, off
// the transform overlay's handles, read from a screenshot so the WebGL
// canvas needn't keep its drawing buffer.
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
      Math.floor(image.width / 4),
      Math.floor(image.height / 4),
      1,
      1,
    ).data;
    return [pixel[0], pixel[1], pixel[2]];
  }, png.toString("base64"));
}

// How far apart two colors are, in their most different channel.
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

test("a layer without effects of its own has a lit FX button that turns its clips' FX off and on", async ({
  page,
}) => {
  await page.goto("/");
  const fx = header(page, "1").locator(".track-label__fx");
  await expect(fx).toBeEnabled();
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expect(fx).toHaveAttribute("title", "Turn Layer 1 FX off");

  await insertFillAtStart(page, "1");
  // A gradient, which the clip-level effect below visibly recolors.
  await page
    .locator('section[aria-label="Color"]')
    .getByRole("button", { name: "Gradient" })
    .click();
  await page.mouse.move(0, 0);
  const plain = await previewColor(page);

  await page.getByRole("button", { name: "Add device to this clip" }).click();
  await page.getByRole("menuitem", { name: "Negative Split" }).click();
  const device = page.locator(
    `.fx-chain :is(section[data-fx-group="clip"], [data-fx-group="clip"] > section)[aria-label="Negative Split"]`,
  );
  await expect(device).toHaveCount(1);
  await expect
    .poll(async () => difference(await previewColor(page), plain))
    .toBeGreaterThan(64);
  const withFx = await previewColor(page);
  await expect(fx).toHaveAttribute("aria-pressed", "true");

  await fx.click();
  await expect(fx).toHaveAttribute("aria-pressed", "false");
  await expect(fx).toHaveAttribute("title", "Turn Layer 1 FX on");
  await expect(header(page, "1")).toContainText("FX off");
  await expect(device).toHaveClass(/fx-device-panel--layer-off/);
  await expectPreview(page, plain);

  await fx.click();
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expect(device).not.toHaveClass(/fx-device-panel--layer-off/);
  await expectPreview(page, withFx);

  // Each toggle is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(fx).toHaveAttribute("aria-pressed", "false");
  await expectPreview(page, plain);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expectPreview(page, withFx);
});

test("every layer's FX button is enabled and lit by default", async ({
  page,
}) => {
  await page.goto("/");
  for (const id of ["1", "5", "6"]) {
    const fx = header(page, id).locator(".track-label__fx");
    await expect(fx).toBeEnabled();
    await expect(fx).toHaveAttribute("aria-pressed", "true");
  }
});

// The FX switch is plain text (#721): amber while on, muted while off, with
// no chip, border or background either way.
test("a layer's FX button is plain text, amber when on and muted when off", async ({
  page,
}) => {
  await page.goto("/");
  const fx = header(page, "1").locator(".track-label__fx");
  await page.mouse.move(0, 0);
  await expect(fx).toHaveAttribute("aria-pressed", "true");
  await expect(fx).toHaveCSS("color", "rgb(246, 183, 60)");
  await expect(fx).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(fx).toHaveCSS("border-top-width", "0px");

  await fx.click();
  await page.mouse.move(0, 0);
  await expect(fx).toHaveAttribute("aria-pressed", "false");
  await expect(fx).toHaveCSS("color", "rgb(164, 169, 191)");
  await expect(fx).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(fx).toHaveCSS("border-top-width", "0px");
});
