import { expect, type Page, test } from "@playwright/test";

// Bloom (#825): bright areas glow into their surroundings. Added from a
// layer's Video → Stylize menu, and rendered in real WebGL on a small
// synthetic frame.

type Rgba = [number, number, number, number];

type Parameter = { key: string; value: string; numericValue?: number };

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

const bloomDevice = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Bloom"]');

// Types `value` into a knob's readout.
async function setKnob(page: Page, label: string, value: string) {
  const device = bloomDevice(page);
  await device
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("Bloom is added from a layer's Video → Stylize menu with its defaults and lights up the preview", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page, "1");
  // A gradient whose colors all sit below Bloom's default Threshold.
  await page
    .locator('section[aria-label="Color"]')
    .getByRole("button", { name: "Gradient" })
    .click();
  await page.mouse.move(0, 0);
  const plain = await previewColor(page);

  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Stylize" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Bloom/ }).click();

  const device = bloomDevice(page);
  await expect(device).toHaveCount(1);
  for (const [label, text] of [
    ["Threshold", "70%"],
    ["Intensity", "60%"],
    ["Radius", "40%"],
  ]) {
    await expect(device.getByRole("slider", { name: label })).toHaveAttribute(
      "aria-valuetext",
      text,
    );
  }
  await expect(device.getByText("Tint", { exact: true })).toBeVisible();
  const animation = device.getByRole("button", {
    name: "Turn Animation Off for Bloom",
  });
  await expect(animation).toHaveAttribute("aria-pressed", "true");
  await animation.click();

  // Nothing is above the default Threshold, so the frame is unchanged.
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(await previewColor(page), plain))
    .toBeLessThan(4);

  // At Threshold 0 everything glows, brightening the frame.
  await setKnob(page, "Threshold", "0");
  await expect(
    device.getByRole("slider", { name: "Threshold" }),
  ).toHaveAttribute("aria-valuetext", "0%");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => {
      const color = await previewColor(page);
      return Math.min(...color.map((value, index) => value - plain[index]));
    })
    .toBeGreaterThan(16);
});

const WIDTH = 320;
const HEIGHT = 180;

// A WIDTH×HEIGHT frame of one fill clip painted `paint` (a CSS color or
// gradient) on Layer 1, with a Bloom of `parameters` on the layer, or none
// when they are undefined. Returns every pixel of the middle row as RGBA.
async function renderRow(
  page: Page,
  paint: string,
  parameters: Parameter[] | undefined,
) {
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
          id: "bloom-1",
          trackId: "1",
          effectName: "Bloom",
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
          height / 2,
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
    { paint, parameters, width: WIDTH, height: HEIGHT },
  ) as Promise<Rgba[]>;
}

// Bloom's parameters: its defaults, overridden by `values`, and `tint`.
function bloom(values: Record<string, number> = {}, tint?: string) {
  const parameters: Parameter[] = Object.entries({
    _Threshold: 0.7,
    _Intensity: 0.6,
    _Radius: 0.4,
    ...values,
  }).map(([key, value]) => ({
    key,
    value: String(value),
    numericValue: value,
  }));
  return tint ? [...parameters, { key: "_Tint", value: tint }] : parameters;
}

// Black on the left half, white on the right, with a hard edge between.
const HALF_WHITE =
  "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(255,255,255,1) 50%, rgba(255,255,255,1) 100%)";

// The first white pixel of a HALF_WHITE row.
function edgeOf(row: Rgba[]) {
  return row.findIndex(([red]) => red > 128);
}

test.describe("Bloom rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  test("Intensity 0 leaves the frame as it was", async ({ page }) => {
    const plain = await renderRow(page, HALF_WHITE, undefined);
    expect(
      await renderRow(page, HALF_WHITE, bloom({ _Intensity: 0, _Radius: 1 })),
    ).toEqual(plain);
  });

  test("a frame with every pixel below Threshold is unchanged", async ({
    page,
  }) => {
    const gray = "rgba(150,150,150,1)";
    const plain = await renderRow(page, gray, undefined);
    expect(
      await renderRow(page, gray, bloom({ _Intensity: 2, _Radius: 1 })),
    ).toEqual(plain);
  });

  test("bright areas glow smoothly into the dark beside them", async ({
    page,
  }) => {
    const plain = await renderRow(page, HALF_WHITE, undefined);
    const edge = edgeOf(plain);
    expect(edge).toBeGreaterThan(140);
    expect(edge).toBeLessThan(180);
    expect(plain[edge - 2][0]).toBeLessThan(8);

    const row = await renderRow(page, HALF_WHITE, bloom());
    // The default reach: 40% of 12% of the 180 px side.
    const reach = Math.round(0.4 * 0.12 * HEIGHT);
    const glow = (x: number) => row[x][0];
    expect(glow(edge - 1)).toBeGreaterThan(24);
    expect(glow(edge - 1)).toBeGreaterThan(glow(edge - Math.ceil(reach / 2)));
    expect(glow(edge - Math.ceil(reach / 2))).toBeGreaterThan(0);
    // Away from the edge the dark stays dark and the white stays white.
    expect(row[edge - reach - 4].slice(0, 3)).toEqual(
      plain[edge - reach - 4].slice(0, 3),
    );
    expect(row[10].slice(0, 3)).toEqual([0, 0, 0]);
    expect(row[WIDTH - 10].slice(0, 3)).toEqual([255, 255, 255]);
    // A white glow stays neutral.
    const [red, green, blue] = row[edge - 1];
    expect(Math.abs(red - green)).toBeLessThan(4);
    expect(Math.abs(red - blue)).toBeLessThan(4);

    // No banding: the glow falls off without steps between neighbors.
    for (let x = edge - reach; x < edge - 1; x++) {
      expect(Math.abs(glow(x + 1) - glow(x)), `x = ${x}`).toBeLessThan(48);
    }
  });

  test("Tint colors the glow and Radius spreads it", async ({ page }) => {
    const edge = edgeOf(await renderRow(page, HALF_WHITE, undefined));

    const red = await renderRow(page, HALF_WHITE, bloom({}, "#ff0000"));
    expect(red[edge - 1][0]).toBeGreaterThan(24);
    expect(red[edge - 1][1]).toBeLessThan(4);
    expect(red[edge - 1][2]).toBeLessThan(4);

    const wide = await renderRow(page, HALF_WHITE, bloom({ _Radius: 1 }));
    const narrow = await renderRow(page, HALF_WHITE, bloom({ _Radius: 0.2 }));
    expect(wide[edge - 12][0]).toBeGreaterThan(narrow[edge - 12][0]);
  });
});
