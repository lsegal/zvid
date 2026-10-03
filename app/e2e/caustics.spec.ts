import { expect, type Page, test } from "@playwright/test";

// The Caustics video effect (#822): added to a layer from its add menu's
// Video → Stylize submenu, with its controls at their defaults, and lighting
// the preview as its knobs change.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

function causticsDevice(page: Page) {
  return page.locator(
    `.fx-chain :is(section[data-fx-group="layer"], [data-fx-group="layer"] > section)[aria-label="Caustics"]`,
  );
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

// The preview, read from a screenshot so the WebGL canvas needn't keep its
// drawing buffer.
async function previewShot(page: Page) {
  await page.mouse.move(0, 0);
  const png = await page
    .locator(".composition-player__canvas")
    .screenshot({ animations: "disabled" });
  return png.toString("base64");
}

// The mean difference per channel, 0..255, between two preview shots.
function shotDifference(page: Page, left: string, right: string) {
  return page.evaluate(
    async ([a, b]) => {
      async function pixels(data: string) {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No 2D context");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      }
      const [first, second] = await Promise.all([pixels(a), pixels(b)]);
      if (first.length !== second.length) {
        return 255;
      }
      let total = 0;
      let count = 0;
      for (let index = 0; index < first.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          total += Math.abs(first[index + channel] - second[index + channel]);
          count += 1;
        }
      }
      return total / count;
    },
    [left, right],
  );
}

async function setKnob(page: Page, label: string, value: string) {
  const device = causticsDevice(page);
  await device
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("Caustics is added from a layer's Video → Stylize menu with its defaults and lights the preview", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page, "1");
  // A gradient, so the warp has detail to bend.
  await page
    .locator('section[aria-label="Color"]')
    .getByRole("button", { name: "Gradient" })
    .click();
  const plain = await previewShot(page);

  await page
    .getByRole("button", { name: "Add device to this layer" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await menu
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Stylize" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Caustics/ }).click();

  const device = causticsDevice(page);
  await expect(device).toHaveCount(1);
  for (const [label, text] of [
    ["Intensity", "50%"],
    ["Scale", "50%"],
    ["Speed", "30%"],
    ["Warp", "10%"],
  ]) {
    await expect(
      device.getByRole("slider", { name: label, exact: true }),
    ).toHaveAttribute("aria-valuetext", text);
  }
  await expect(device.getByRole("button", { name: "Screen" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(device.getByText("Color", { exact: true })).toBeVisible();

  // At its defaults it already lights the layer.
  await expect
    .poll(async () => shotDifference(page, await previewShot(page), plain))
    .toBeGreaterThan(1);
  const defaults = await previewShot(page);

  // Full intensity added on top lights it far more.
  await setKnob(page, "Intensity", "100");
  await device.getByRole("button", { name: "Add" }).click();
  await expect(
    device.getByRole("slider", { name: "Intensity", exact: true }),
  ).toHaveAttribute("aria-valuetext", "100%");
  await expect
    .poll(async () => shotDifference(page, await previewShot(page), defaults))
    .toBeGreaterThan(1);

  // Intensity 0 with Warp 0 leaves the layer as it was.
  await setKnob(page, "Intensity", "0");
  await setKnob(page, "Warp", "0");
  await expect
    .poll(async () => shotDifference(page, await previewShot(page), plain))
    .toBeLessThan(0.5);
});
