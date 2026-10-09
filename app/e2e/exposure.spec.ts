import { expect, type Page, test } from "@playwright/test";

// Exposure (#1127): brightens or darkens what it's applied to in stops.
// Added from a layer's Video → Color menu, and rendered in real WebGL on
// small synthetic frames.

type Rgba = [number, number, number, number];

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a fill clip on layer 1 and moves the playhead to its middle, where
// it is fully drawn.
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
  const fill = lane(page, "1").locator(".clip-card--fill");
  await expect(fill).toHaveClass(/clip-card--selected/);
  const clip = await fill.boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
}

// The preview's mean gray level, read from a screenshot so the WebGL canvas
// needn't keep its drawing buffer.
async function previewBrightness(page: Page) {
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
      0,
      0,
      image.width,
      image.height,
    );
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      total += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
    }
    return total / (pixels.length / 4);
  }, png.toString("base64"));
}

const exposureDevice = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Exposure"]');

// Types `value` into the Exposure knob's readout and waits for `readout`.
async function setStops(page: Page, value: string, readout: string) {
  const device = exposureDevice(page);
  await device.getByRole("button", { name: /^Exposure: / }).dblclick();
  const input = device.getByRole("textbox", { name: "Exposure value" });
  await input.fill(value);
  await input.press("Enter");
  await expect(
    device.getByRole("slider", { name: "Exposure" }),
  ).toHaveAttribute("aria-valuetext", readout);
}

test("Exposure is added from a layer's Video → Color menu and brightens the preview as the knob moves up", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page);
  const plain = await previewBrightness(page);

  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Color", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Exposure/ }).click();

  const device = exposureDevice(page);
  await expect(device).toHaveCount(1);
  await expect(
    device.getByRole("slider", { name: "Exposure" }),
  ).toHaveAttribute("aria-valuetext", "0.0 EV");
  // A static grading tool, it comes with Animation off.
  await expect(
    device.getByRole("button", { name: "Turn Animation On for Exposure" }),
  ).toHaveAttribute("aria-pressed", "false");

  // 0 stops leaves the preview as it was.
  await expect
    .poll(async () => Math.abs((await previewBrightness(page)) - plain))
    .toBeLessThan(0.5);

  // Each stop up brightens it further.
  await setStops(page, "1", "+1.0 EV");
  await expect
    .poll(async () => previewBrightness(page))
    .toBeGreaterThan(plain + 5);
  const oneStop = await previewBrightness(page);
  await setStops(page, "2", "+2.0 EV");
  await expect
    .poll(async () => previewBrightness(page))
    .toBeGreaterThan(oneStop + 5);

  // Stops down darken it.
  await setStops(page, "-1", "-1.0 EV");
  await expect
    .poll(async () => previewBrightness(page))
    .toBeLessThan(plain - 5);
});

// The middle pixel of a `width`×`height` frame of one fill clip painted
// `paint` (a CSS color) on Layer 1, with an Exposure of `stops` on the
// layer, or none when it is undefined.
async function renderPixel(
  page: Page,
  paint: string,
  stops: number | undefined,
  width = 64,
  height = 36,
) {
  return page.evaluate(
    async ({ paint, stops, width, height }) => {
      // A variable keeps TypeScript from resolving the dev server's path.
      const modulePath = "/src/CompositionPlayer.tsx";
      const { CompositionRenderer } = await import(
        /* @vite-ignore */ modulePath
      );
      const effects: unknown[] = [
        {
          id: "color-1",
          trackId: "1",
          effectName: "Color",
          enabled: true,
          parameters: [
            { key: "Mode", value: "Solid" },
            { key: "Color", value: paint },
            { key: "Opacity", value: "1", numericValue: 1 },
          ],
        },
      ];
      if (stops !== undefined) {
        effects.push({
          id: "exposure-1",
          trackId: "1",
          effectName: "Exposure",
          enabled: true,
          parameters: [
            { key: "_Stops", value: String(stops), numericValue: stops },
          ],
        });
      }
      const canvas = document.createElement("canvas");
      const renderer = new CompositionRenderer(
        {
          mediaItems: [],
          clips: [
            {
              id: "fill-1",
              kind: "fill",
              sourceSpanId: "",
              sourceTrackId: "",
              laneId: "1",
              label: "Fill",
              mediaPath: "",
              startQ: 0,
              durationSeconds: 4,
              trimStartSeconds: 0,
              sourceOffsetSeconds: 0,
              sourceWindowStartSeconds: 0,
              sourceWindowEndSeconds: 4,
              tint: "#000",
              accent: "#fff",
            },
          ],
          lanes: [{ id: "1", name: "Layer 1", colorIndex: 0 }],
          effects,
          bpm: 120,
          canvasWidth: width,
          canvasHeight: height,
        },
        { canvas, audioAnalysis: "offline" },
      );
      try {
        await renderer.renderFrameAt(1, 0.5);
        const gl = canvas.getContext("webgl");
        if (!gl) throw new Error("WebGL is unavailable.");
        const pixel = new Uint8Array(4);
        gl.readPixels(
          Math.floor(width / 2),
          Math.floor(height / 2),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        return Array.from(pixel);
      } finally {
        renderer.destroy();
      }
    },
    { paint, stops, width, height },
  ) as Promise<Rgba>;
}

// An 8-bit sRGB level in linear light.
function toLinear(level: number) {
  const value = level / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

test.describe("Exposure rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  test("0 stops leaves the frame as it was", async ({ page }) => {
    const paint = "rgb(120,60,200)";
    expect(await renderPixel(page, paint, 0)).toEqual(
      await renderPixel(page, paint, undefined),
    );
  });

  test("each stop doubles or halves the linear light", async ({ page }) => {
    const paint = "rgb(100,60,30)";
    const plain = await renderPixel(page, paint, undefined);
    const up = await renderPixel(page, paint, 1);
    const down = await renderPixel(page, paint, -1);
    for (let channel = 0; channel < 3; channel++) {
      const linear = toLinear(plain[channel]);
      expect(
        Math.abs(toLinear(up[channel]) - 2 * linear),
        `+1, channel ${channel}`,
      ).toBeLessThan(0.01);
      expect(
        Math.abs(toLinear(down[channel]) - linear / 2),
        `-1, channel ${channel}`,
      ).toBeLessThan(0.01);
    }
    expect(up[3]).toBe(plain[3]);
    expect(down[3]).toBe(plain[3]);
  });

  test("clamps to the displayable range", async ({ page }) => {
    const [red, green, blue] = await renderPixel(page, "rgb(200,128,0)", 4);
    expect(red).toBe(255);
    expect(green).toBe(255);
    expect(blue).toBe(0);
  });
});
