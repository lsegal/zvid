import { expect, type Page, test } from "@playwright/test";

// Gaussian Blur (#1024): blurs what it's applied to by its Radius. Added
// from a layer's Video → Stylize menu, and rendered in real WebGL on small
// synthetic frames.

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

const blurDevice = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Gaussian Blur"]');

// Types `value` into the Radius knob's readout.
async function setRadius(page: Page, value: string) {
  const device = blurDevice(page);
  await device.getByRole("button", { name: /^Radius: / }).dblclick();
  const input = device.getByRole("textbox", { name: "Radius value" });
  await input.fill(value);
  await input.press("Enter");
  await expect(device.getByRole("slider", { name: "Radius" })).toHaveAttribute(
    "aria-valuetext",
    `${value} px`,
  );
}

test("Gaussian Blur is added from a layer's Video → Stylize menu and blurs the preview more as Radius grows", async ({
  page,
}) => {
  await page.goto("/");
  await insertTextAtStart(page);
  const sharp = await previewPixels(page);

  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Stylize" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Gaussian Blur/ }).click();

  const device = blurDevice(page);
  await expect(device).toHaveCount(1);
  await expect(device.getByRole("slider", { name: "Radius" })).toHaveAttribute(
    "aria-valuetext",
    "20 px",
  );
  const animation = device.getByRole("button", {
    name: "Turn Animation Off for Gaussian Blur",
  });
  await expect(animation).toHaveAttribute("aria-pressed", "true");
  await animation.click();

  // The default Radius softens the text.
  await expect
    .poll(async () => change(await previewPixels(page), sharp))
    .toBeGreaterThan(0.1);
  const atDefault = change(await previewPixels(page), sharp);

  // A larger Radius spreads it further.
  await setRadius(page, "80");
  await expect
    .poll(async () => change(await previewPixels(page), sharp))
    .toBeGreaterThan(atDefault * 1.5);

  // Radius 0 leaves the text sharp.
  await setRadius(page, "0");
  await expect
    .poll(async () => change(await previewPixels(page), sharp))
    .toBeLessThan(0.02);
});

// A `width`×`height` frame of one fill clip painted `paint` (a CSS color or
// gradient) on Layer 1, with a Gaussian Blur of `radius` on the layer, or
// none when it is undefined. Returns every pixel of the middle row as RGBA.
async function renderRow(
  page: Page,
  paint: string,
  radius: number | undefined,
  width = 320,
  height = 180,
) {
  const parameters: Parameter[] | undefined =
    radius === undefined
      ? undefined
      : [{ key: "_Radius", value: String(radius), numericValue: radius }];
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
          id: "blur-1",
          trackId: "1",
          effectName: "GaussianBlur",
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

// `left` on the left half, `right` on the right, with a hard edge between.
function halves(left: string, right: string) {
  return `linear-gradient(90deg, ${left} 0%, ${left} 50%, ${right} 50%, ${right} 100%)`;
}

const HALF_WHITE = halves("rgba(0,0,0,1)", "rgba(255,255,255,1)");

// The first bright pixel of a row.
function edgeOf(row: Rgba[]) {
  return row.findIndex(([red]) => red > 128);
}

// How many pixels a row takes to rise from 10% to 90% red.
function spread(row: Rgba[]) {
  const first = row.findIndex(([red]) => red > 25);
  const last = row.findIndex(([red]) => red > 230);
  return last - first;
}

test.describe("Gaussian Blur rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  test("Radius 0 leaves the frame as it was", async ({ page }) => {
    const plain = await renderRow(page, HALF_WHITE, undefined);
    expect(await renderRow(page, HALF_WHITE, 0)).toEqual(plain);
  });

  test("a hard edge blurs into a smooth, symmetric falloff", async ({
    page,
  }) => {
    const plain = await renderRow(page, HALF_WHITE, undefined);
    const edge = edgeOf(plain);
    expect(plain[edge - 2][0]).toBeLessThan(8);

    // 30 px at 1080p is 5 px of this 180 px frame.
    const row = await renderRow(page, HALF_WHITE, 30);
    const level = (x: number) => row[x][0];
    expect(level(edge - 1)).toBeGreaterThan(24);
    expect(level(edge)).toBeLessThan(231);
    // Mirrored about the edge, the dark side rises as the bright side
    // falls.
    for (let distance = 0; distance < 8; distance++) {
      expect(
        Math.abs(level(edge - 1 - distance) + level(edge + distance) - 255),
        `distance = ${distance}`,
      ).toBeLessThan(6);
    }
    // No banding: it rises steadily without steps between neighbors.
    for (let x = edge - 10; x < edge + 10; x++) {
      expect(level(x + 1), `x = ${x}`).toBeGreaterThanOrEqual(level(x));
      expect(level(x + 1) - level(x), `x = ${x}`).toBeLessThan(64);
    }
    // Away from the edge the halves keep their colors, out to the frame's
    // own edges, which aren't wrapped around.
    expect(row[10].slice(0, 3)).toEqual([0, 0, 0]);
    expect(row[309].slice(0, 3)).toEqual([255, 255, 255]);
    expect(row[0].slice(0, 3)).toEqual([0, 0, 0]);
    expect(row[319].slice(0, 3)).toEqual([255, 255, 255]);
    // A gray blur stays neutral.
    const [red, green, blue] = row[edge - 1];
    expect(Math.abs(red - green)).toBeLessThan(3);
    expect(Math.abs(red - blue)).toBeLessThan(3);
  });

  test("transparent areas don't darken the edges they meet", async ({
    page,
  }) => {
    // Red fading into transparency must cover the background just as red
    // fading into opaque black covers it with red: the black version's red
    // level is the coverage. Blurring the transparent pixels' color in
    // unweighted would darken it.
    const fading = halves("rgba(255,0,0,1)", "rgba(0,0,0,0)");
    const transparent = await renderRow(page, fading, 60);
    const black = await renderRow(
      page,
      halves("rgba(255,0,0,1)", "rgba(0,0,0,1)"),
      60,
    );
    const background = (await renderRow(page, fading, undefined))[319];
    for (let x = 140; x < 180; x++) {
      const coverage = black[x][0] / 255;
      const expected = 255 * coverage + background[0] * (1 - coverage);
      expect(Math.abs(transparent[x][0] - expected), `x = ${x}`).toBeLessThan(
        4,
      );
    }
    expect(transparent[165][0] - background[0]).toBeGreaterThan(4);
  });

  test("the Radius scales with the output size", async ({ page }) => {
    const paint = halves("rgba(0,0,0,1)", "rgba(255,0,0,1)");
    const small = spread(await renderRow(page, paint, 60, 320, 180));
    const large = spread(await renderRow(page, paint, 60, 640, 360));
    expect(small).toBeGreaterThan(4);
    expect(Math.abs(large - 2 * small)).toBeLessThanOrEqual(2);
  });

  test("the strongest blur stays smooth", async ({ page }) => {
    const row = await renderRow(page, HALF_WHITE, 100, 640, 360);
    const level = (x: number) => row[x][0];
    for (let x = 200; x < 440; x++) {
      expect(level(x + 1), `x = ${x}`).toBeGreaterThanOrEqual(level(x));
      expect(level(x + 1) - level(x), `x = ${x}`).toBeLessThan(12);
    }
    expect(level(310)).toBeGreaterThan(24);
    expect(level(330)).toBeLessThan(231);
  });
});
