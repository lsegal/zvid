import { expect, type Page, test } from "@playwright/test";

// The Digital Glitch video effect: added to a layer from its add menu's
// Stylize group, beside Analog Glitch, with its controls at their defaults,
// and glitching the preview once its Amount turns up.
test.use({ viewport: { width: 1600, height: 1200 } });

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a gradient fill clip on layer `laneId` and moves the playhead to
// its middle, where it is fully drawn.
async function insertGradientFill(page: Page, laneId: string) {
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
  await page
    .locator('section[aria-label="Color"]')
    .getByRole("button", { name: "Gradient" })
    .click();
}

// The preview's pixels, downsampled to a 16×16 grid of RGB values.
async function previewPixels(page: Page) {
  const shot = await page
    .locator(".composition-player__canvas")
    .screenshot({ animations: "disabled" });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D context");
    context.drawImage(image, 0, 0, 16, 16);
    return Array.from(context.getImageData(0, 0, 16, 16).data).filter(
      (_, index) => index % 4 !== 3,
    );
  }, shot.toString("base64"));
}

// The mean per-channel difference between two samples, 0-255.
function difference(a: number[], b: number[]) {
  let sum = 0;
  for (const [index, value] of a.entries()) {
    sum += Math.abs(value - b[index]);
  }
  return sum / a.length;
}

const glitchDevice = (page: Page) =>
  page.locator(
    `.fx-chain :is(section[data-fx-group="layer"], [data-fx-group="layer"] > section)[aria-label="Digital Glitch"]`,
  );

// Types `value` into a knob's readout.
async function setKnob(page: Page, label: string, value: string) {
  const device = glitchDevice(page);
  await device
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("Digital Glitch is added to a layer from Video → Stylize with its defaults and glitches the preview", async ({
  page,
}) => {
  await page.goto("/");
  await insertGradientFill(page, "1");
  await page.locator('[data-layer-header-id="1"]').click();
  await page.mouse.move(0, 0);
  const original = await previewPixels(page);

  await page.getByRole("button", { name: "Add device to this layer" }).click();
  const menu = page.getByRole("menu").first();
  await menu
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Stylize" })
    .press("ArrowRight");
  const submenu = page.getByRole("menu").last();
  // Listed after Analog Glitch, among the other Stylize effects that sit
  // between it and 60 in the menu order.
  const stylize = await submenu.getByRole("menuitem").allTextContents();
  const analog = stylize.findIndex((name) => name.startsWith("Analog Glitch"));
  const digital = stylize.findIndex((name) =>
    name.startsWith("Digital Glitch"),
  );
  expect(analog).toBeGreaterThanOrEqual(0);
  expect(digital).toBeGreaterThan(analog);
  await submenu.getByRole("menuitem", { name: /^Digital Glitch/ }).click();

  const device = glitchDevice(page);
  await expect(device).toHaveCount(1);
  for (const [label, text] of [
    ["Amount", "30%"],
    ["Block Size", "40%"],
    ["Displace", "50%"],
    ["Channel Shift", "30%"],
    ["Color Crush", "0%"],
    ["Rate", "8 /s"],
  ]) {
    await expect(
      device.getByRole("slider", { name: label, exact: true }),
    ).toHaveAttribute("aria-valuetext", text);
  }
  // Clip-mode Animation, on for a new device, would ease Amount in from the
  // clip's start; switching it off shows the effect as set.
  await device.getByRole("button", { name: /^Turn Animation Off/ }).click();

  // Amount 0 leaves the frame as it was.
  await setKnob(page, "Amount", "0");
  await expect(
    device.getByRole("slider", { name: "Amount", exact: true }),
  ).toHaveAttribute("aria-valuetext", "0%");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(original, await previewPixels(page)))
    .toBeLessThan(0.5);
  const plain = await previewPixels(page);

  // Glitching every block at full displacement and crush moves the picture.
  await setKnob(page, "Amount", "1");
  await setKnob(page, "Displace", "1");
  await setKnob(page, "Color Crush", "1");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(plain, await previewPixels(page)), {
      timeout: 15_000,
    })
    .toBeGreaterThan(4);
});
