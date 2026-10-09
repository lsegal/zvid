import { expect, type Page, test } from "@playwright/test";

// Contrast (#1128): pushes each channel away from, or pulls it toward, a
// pivot gray. Added from a layer's Video → Color menu, and rendered in real
// WebGL on small synthetic frames.

type Rgba = [number, number, number, number];

type Parameter = { key: string; value: string; numericValue?: number };

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a text clip on layer 1, selected, and moves the playhead to its
// middle, where it is fully drawn.
async function insertTextAtStart(page: Page) {
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
    .getByRole("menuitem", { name: "Insert Text Clip" })
    .click();
  const text = lane(page, "1").locator(".clip-card--text");
  await expect(text).toHaveClass(/clip-card--selected/);
  const clip = await text.boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
}

// The preview's pixels as gray levels, read from a screenshot so the WebGL
// canvas needn't keep its drawing buffer.
async function previewPixels(page: Page) {
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
    const gray: number[] = [];
    for (let index = 0; index < pixels.length; index += 4) {
      gray.push((pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3);
    }
    return gray;
  }, png.toString("base64"));
}

// How much of the picture changed: the mean difference between two
// previews' gray levels.
function change(left: number[], right: number[]) {
  const total = left.reduce(
    (sum, value, index) => sum + Math.abs(value - right[index]),
    0,
  );
  return total / left.length;
}

const contrastDevice = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Contrast"]');

// Types `value` into the Contrast knob's readout.
async function setContrast(page: Page, value: string) {
  const device = contrastDevice(page);
  await device.getByRole("button", { name: /^Contrast: / }).dblclick();
  const input = device.getByRole("textbox", { name: "Contrast value" });
  await input.fill(value);
  await input.press("Enter");
  await expect(
    device.getByRole("slider", { name: "Contrast" }),
  ).toHaveAttribute("aria-valuetext", Number(value).toFixed(3));
}

test("Contrast is added from a layer's Video → Color menu and changes the preview as its knob moves", async ({
  page,
}) => {
  await page.goto("/");
  await insertTextAtStart(page);
  const plain = await previewPixels(page);

  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Color", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Contrast/ }).click();

  const device = contrastDevice(page);
  await expect(device).toHaveCount(1);
  await expect(
    device.getByRole("slider", { name: "Contrast" }),
  ).toHaveAttribute("aria-valuetext", "1.000");
  await expect(device.getByRole("slider", { name: "Pivot" })).toHaveAttribute(
    "aria-valuetext",
    "0.435",
  );
  const animation = device.getByRole("button", {
    name: "Turn Animation Off for Contrast",
  });
  await expect(animation).toHaveAttribute("aria-pressed", "true");
  await animation.click();

  // The default Contrast of 1 leaves the picture as it was.
  await expect
    .poll(async () => change(await previewPixels(page), plain))
    .toBeLessThan(0.02);

  // Contrast 0 flattens it toward the pivot gray.
  await setContrast(page, "0");
  await expect
    .poll(async () => change(await previewPixels(page), plain))
    .toBeGreaterThan(1);
  const flat = await previewPixels(page);

  // Contrast 2 steepens it instead.
  await setContrast(page, "2");
  await expect
    .poll(async () => change(await previewPixels(page), flat))
    .toBeGreaterThan(1);

  // Back at 1, it is untouched again.
  await setContrast(page, "1");
  await expect
    .poll(async () => change(await previewPixels(page), plain))
    .toBeLessThan(0.02);
});

// A `width`×`height` frame of one fill clip painted `paint` (a CSS color or
// gradient) on Layer 1, with a Contrast of `contrast` about `pivot` on the
// layer, or none when `contrast` is undefined. Returns every pixel of the
// middle row as RGBA.
async function renderRow(
  page: Page,
  paint: string,
  contrast: number | undefined,
  pivot = 0.435,
  width = 64,
  height = 36,
) {
  const parameters: Parameter[] | undefined =
    contrast === undefined
      ? undefined
      : [
          { key: "_Contrast", value: String(contrast), numericValue: contrast },
          { key: "_Pivot", value: String(pivot), numericValue: pivot },
        ];
  return page.evaluate(
    async ({ paint, parameters, width, height }) => {
      // A variable keeps TypeScript from resolving the dev server's path.
      const modulePath = "/src/CompositionPlayer.tsx";
      const { CompositionRenderer } = await import(
        /* @vite-ignore */ modulePath
      );
      const gradient = paint.includes("gradient");
      const color = {
        id: "color-1",
        trackId: "1",
        effectName: "Color",
        enabled: true,
        parameters: [
          { key: "Mode", value: gradient ? "Gradient" : "Solid" },
          { key: gradient ? "Gradient" : "Color", value: paint },
          { key: "Opacity", value: "1", numericValue: 1 },
        ],
      };
      const effects: unknown[] = [color];
      if (parameters) {
        effects.push({
          id: "contrast-1",
          trackId: "1",
          effectName: "Contrast",
          enabled: true,
          parameters,
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
        const pixels = new Uint8Array(width * 4);
        gl.readPixels(
          0,
          Math.floor(height / 2),
          width,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        const row: number[][] = [];
        for (let x = 0; x < width; x++) {
          row.push(Array.from(pixels.slice(x * 4, x * 4 + 4)));
        }
        return row;
      } finally {
        renderer.destroy();
      }
    },
    { paint, parameters, width, height },
  ) as Promise<Rgba[]>;
}

// Black at the left edge to white at the right.
const RAMP =
  "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(255,255,255,1) 100%)";

// What the shader does to one 0..255 level.
function expected(level: number, contrast: number, pivot: number) {
  const value = (level / 255 - pivot) * contrast + pivot;
  return Math.min(Math.max(value, 0), 1) * 255;
}

test.describe("Contrast rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  test("Contrast 1 leaves the frame as it was", async ({ page }) => {
    const plain = await renderRow(page, RAMP, undefined);
    expect(await renderRow(page, RAMP, 1)).toEqual(plain);
    expect(await renderRow(page, RAMP, 1, 0.9)).toEqual(plain);
  });

  test("each channel moves by (c - pivot) * contrast + pivot, clamped", async ({
    page,
  }) => {
    const plain = await renderRow(page, RAMP, undefined);
    for (const [contrast, pivot] of [
      [0.5, 0.435],
      [2, 0.435],
      [1.5, 0.25],
    ]) {
      const row = await renderRow(page, RAMP, contrast, pivot);
      for (let x = 0; x < row.length; x++) {
        for (let channel = 0; channel < 3; channel++) {
          expect(
            Math.abs(
              row[x][channel] - expected(plain[x][channel], contrast, pivot),
            ),
            `contrast ${contrast}, pivot ${pivot}, x = ${x}`,
          ).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  test("the Pivot gray stays fixed at any Contrast", async ({ page }) => {
    // 0.435 of 255 is 111.
    const gray = "rgba(111,111,111,1)";
    for (const contrast of [0, 0.5, 2]) {
      const row = await renderRow(page, gray, contrast);
      for (const pixel of [row[0], row[32], row[63]]) {
        for (const level of pixel.slice(0, 3)) {
          expect(Math.abs(level - 111), `contrast ${contrast}`).toBeLessThan(
            2,
          );
        }
      }
    }
  });

  test("Contrast 0 flattens the frame to the Pivot gray", async ({ page }) => {
    for (const pivot of [0.435, 0.8]) {
      const row = await renderRow(page, RAMP, 0, pivot);
      for (const pixel of row) {
        for (const level of pixel.slice(0, 3)) {
          expect(Math.abs(level - pivot * 255), `pivot ${pivot}`).toBeLessThan(
            2,
          );
        }
      }
    }
  });

  test("a translucent picture keeps its alpha", async ({ page }) => {
    // Half-covered white over the background: flattened to the pivot gray,
    // it must still cover the background by half rather than more or less.
    const translucent = "rgba(255,255,255,0.5)";
    const background = (await renderRow(page, "rgba(0,0,0,0)", undefined))[32];
    const plain = (await renderRow(page, translucent, undefined))[32];
    const coverage = (plain[0] - background[0]) / (255 - background[0]);
    expect(coverage).toBeGreaterThan(0.3);
    expect(coverage).toBeLessThan(0.7);
    const flat = (await renderRow(page, translucent, 0))[32];
    for (let channel = 0; channel < 3; channel++) {
      const want =
        0.435 * 255 * coverage + background[channel] * (1 - coverage);
      expect(Math.abs(flat[channel] - want), `channel ${channel}`).toBeLessThan(
        3,
      );
    }
    expect(flat[3]).toEqual(plain[3]);
  });
});
