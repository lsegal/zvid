import { expect, type Page, test } from "@playwright/test";

// Scopes (#1129): a view-only effect whose panel shows an RGB waveform of
// the picture at its position in the stack, leaving the preview unchanged.

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

// The preview's pixels, read from a screenshot so the WebGL canvas needn't
// keep its drawing buffer, as a list of RGB values.
async function previewPixels(page: Page) {
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
    const { data: rgba } = context.getImageData(
      0,
      0,
      image.width,
      image.height,
    );
    return Array.from(rgba).filter((_, index) => index % 4 !== 3);
  }, png.toString("base64"));
}

// How far apart two pictures are, in their most different channel.
function difference(left: number[], right: number[]) {
  expect(left.length).toBe(right.length);
  let most = 0;
  for (let index = 0; index < left.length; index++) {
    most = Math.max(most, Math.abs(left[index] - right[index]));
  }
  return most;
}

const scopesDevice = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Scopes"]');

// The waveform canvas's pixels as a data URL, and how many of them are lit
// brighter than its graticule, which is the waveform's trace.
async function readWaveform(page: Page) {
  return scopesDevice(page)
    .getByRole("img", { name: "Waveform of Scopes" })
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D context");
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let lit = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (Math.max(data[index], data[index + 1], data[index + 2]) > 200) {
          lit++;
        }
      }
      return { image: canvas.toDataURL(), lit };
    });
}

test("Scopes draws a live waveform of the picture above it and leaves the preview unchanged", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page, "1");
  await page.mouse.move(0, 0);
  const plain = await previewPixels(page);

  // On the clip's own stack, after the Color that paints it.
  await page.getByRole("button", { name: "Add device to this clip" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Color", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Scopes/ }).click();

  const device = scopesDevice(page);
  await expect(device).toHaveCount(1);
  // View only: no knobs and no Animation.
  await expect(device.getByRole("slider")).toHaveCount(0);
  await expect(device.getByRole("button", { name: /Animation/ })).toHaveCount(
    0,
  );

  const waveform = device.getByRole("img", { name: "Waveform of Scopes" });
  await expect(waveform).toHaveAttribute("data-sampled", "true");
  await expect
    .poll(async () => (await readWaveform(page)).lit)
    .toBeGreaterThan(0);

  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(await previewPixels(page), plain))
    .toBeLessThanOrEqual(1);

  // A gradient above it spreads the trace over many levels.
  const solid = await readWaveform(page);
  await page
    .locator('section[aria-label="Color"]')
    .getByRole("button", { name: "Gradient" })
    .click();
  await expect
    .poll(async () => (await readWaveform(page)).image)
    .not.toBe(solid.image);
});
