import { expect, type Locator, type Page, test } from "@playwright/test";

// Levels (#1130): grades what it's applied to with Lift, Gamma, Gain and
// Offset color wheels and a tone curve drawn over a histogram of the
// picture reaching it. Added from a layer's Video → Color menu.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a fill clip, a neutral gray, on layer 1, selected, and moves the
// playhead to its middle.
async function insertFillAtStart(page: Page) {
  const bounds = await lane(page, "1").boundingBox();
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
  const fill = lane(page, "1").locator(".clip-card").first();
  await expect(fill).toHaveClass(/clip-card--selected/);
  const clip = await fill.boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
}

// The mean red, green and blue of a patch of the preview, away from its
// center and edges, where the selected clip's handles are drawn. Read from a
// screenshot so the WebGL canvas needn't keep its drawing buffer.
async function previewColor(page: Page) {
  await page.mouse.move(0, 0);
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
    const { data: pixels } = context.getImageData(
      Math.round(image.width * 0.2),
      Math.round(image.height * 0.2),
      Math.max(1, Math.round(image.width * 0.15)),
      Math.max(1, Math.round(image.height * 0.15)),
    );
    const sum = [0, 0, 0];
    for (let index = 0; index < pixels.length; index += 4) {
      sum[0] += pixels[index];
      sum[1] += pixels[index + 1];
      sum[2] += pixels[index + 2];
    }
    const count = pixels.length / 4;
    return sum.map((value) => value / count) as [number, number, number];
  }, png.toString("base64"));
}

const levelsDevice = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Levels"]');

// Drags from `from` to `to`, in pixels from the top left of `target`, in
// small steps.
async function drag(
  page: Page,
  target: Locator,
  from: [number, number],
  to: [number, number],
) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("The drag target is not visible");
  }
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(
      box.x + from[0] + ((to[0] - from[0]) * step) / 8,
      box.y + from[1] + ((to[1] - from[1]) * step) / 8,
    );
  }
  await page.mouse.up();
  return box;
}

// The saved session payload, or null when nothing is saved.
function readSavedPayload(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open("zvid-workspace");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("sessions")) {
            database.close();
            resolve(null);
            return;
          }
          const get = database
            .transaction("sessions", "readonly")
            .objectStore("sessions")
            .get("current");
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            database.close();
            resolve(
              (get.result as { payload?: string } | undefined)?.payload ?? null,
            );
          };
        };
      }),
  );
}

test("Levels grades a layer with a color wheel and the curve, over a histogram, and keeps its grade after a refresh", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page);
  const [plainRed, plainGreen] = await previewColor(page);

  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Color" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Levels/ }).click();

  const device = levelsDevice(page);
  await expect(device).toHaveCount(1);
  // A static grading tool, it comes with Animation off.
  await expect(
    device.getByRole("button", { name: "Turn Animation On for Levels" }),
  ).toHaveAttribute("aria-pressed", "false");
  for (const wheel of ["Lift", "Gamma", "Gain", "Offset"]) {
    await expect(
      device.getByRole("slider", { name: `${wheel} color` }),
    ).toBeVisible();
  }
  const gainRed = device.getByRole("textbox", { name: "Gain R" });
  await expect(gainRed).toHaveValue("1.00");

  // The histogram of the gray fill reaching the effect fills in behind the
  // curve.
  await expect(device.locator("[data-fx-histogram]")).toHaveAttribute("d", /L/);

  // Its defaults leave the picture as it is.
  expect(Math.abs((await previewColor(page))[1] - plainGreen)).toBeLessThan(2);

  // Dragging the Gain puck toward red, at the top, warms the gray: more red,
  // less green.
  const gainWheel = device.getByRole("slider", { name: "Gain color" });
  await drag(page, gainWheel, [44, 44], [44, 4]);
  await expect(gainRed).not.toHaveValue("1.00");
  await expect(device.getByRole("textbox", { name: "Gain G" })).not.toHaveValue(
    "1.00",
  );
  await expect
    .poll(async () => (await previewColor(page))[1])
    .toBeLessThan(plainGreen - 20);
  const [tintedRed, tintedGreen] = await previewColor(page);
  expect(tintedRed).toBeGreaterThan(plainRed + 30);

  // Dragging the master curve's white point halfway down darkens it.
  const plot = device.locator('[data-fx-curve="master"]');
  await plot.scrollIntoViewIfNeeded();
  const plotBox = await plot.boundingBox();
  if (!plotBox) {
    throw new Error("The curve is not visible");
  }
  await drag(
    page,
    plot,
    [plotBox.width - 2, 2],
    [plotBox.width - 2, plotBox.height / 2],
  );
  const whitePoint = device.getByRole("slider", {
    name: "Master curve point 2",
  });
  await expect(whitePoint).toHaveAttribute(
    "aria-valuetext",
    /^in 1.00, out 0.(4|5)/,
  );
  await expect
    .poll(async () => (await previewColor(page))[1])
    .toBeLessThan(tintedGreen * 0.7);
  const [, gradedGreen] = await previewColor(page);
  const gradedGainRed = await gainRed.inputValue();
  const whitePointText = await whitePoint.getAttribute("aria-valuetext");

  // A refresh brings the grade back from the saved session.
  await expect
    .poll(
      async () =>
        /"0,0 1,0\.\d+\|\|\|"/.test((await readSavedPayload(page)) ?? ""),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.reload();
  await expect(lane(page, "1").locator(".clip-card")).toHaveCount(1);
  await page.locator('[data-layer-header-id="1"]').click();
  await expect(device).toHaveCount(1);
  await expect(gainRed).toHaveValue(gradedGainRed);
  await expect(whitePoint).toHaveAttribute(
    "aria-valuetext",
    whitePointText ?? "",
  );
  await expect
    .poll(async () => Math.abs((await previewColor(page))[1] - gradedGreen))
    .toBeLessThan(3);

  // The curve drag is one undo step, kept across the refresh.
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Undo/ }).click();
  await expect(whitePoint).toHaveAttribute(
    "aria-valuetext",
    "in 1.00, out 1.00",
  );
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Redo/ }).click();
  await expect(whitePoint).toHaveAttribute(
    "aria-valuetext",
    whitePointText ?? "",
  );
});
