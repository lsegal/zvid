import { expect, type Page, test } from "@playwright/test";

// Shape (#1006): a layer draws only inside a shape stretched over its box.
// Added from a layer's Video → Transform menu with a centered square
// Transform, its shape picked from a popout of black-on-white previews, and
// rendered in real WebGL on a small synthetic frame.

type Rgba = [number, number, number, number];

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a fill clip on layer `laneId`, selected.
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
  await expect(lane(page, laneId).locator(".clip-card--fill")).toHaveClass(
    /clip-card--selected/,
  );
}

async function addLayerDevice(page: Page, category: string, name: RegExp) {
  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: category, exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name }).click();
}

const shapeDevice = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Shape"]');
const transformDevice = (page: Page) =>
  page.locator('.fx-chain section[aria-label="Transform"]');

test("Shape is added with a centered square Transform and picks its shape from a popout of previews", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page, "1");
  await expect(transformDevice(page)).toHaveCount(0);

  await addLayerDevice(page, "Transform", /^Shape/);
  await expect(shapeDevice(page)).toHaveCount(1);
  // The layer had no Transform, so one is added: a square half the canvas
  // height across, centered.
  const transform = transformDevice(page);
  await expect(transform).toHaveCount(1);
  for (const [label, text] of [
    ["X", "0%"],
    ["Y", "0%"],
    ["Height", "50%"],
    ["Rotation", "0°"],
  ]) {
    await expect(
      transform.getByRole("slider", { name: label, exact: true }),
    ).toHaveAttribute("aria-valuetext", text);
  }
  // Shape has no knobs, so it has no Animation.
  await expect(
    shapeDevice(page).getByRole("button", { name: /Animation/ }),
  ).toHaveCount(0);

  const trigger = shapeDevice(page).getByRole("button", { name: /^Shape: / });
  await expect(trigger).toHaveAccessibleName("Shape: Rectangle");
  for (const name of ["Oval", "Star", "Arrow", "Rectangle"]) {
    await trigger.click();
    const options = page
      .getByRole("listbox")
      .getByRole("option", { includeHidden: false });
    await expect(options).toHaveCount(4);
    // Every option is a black-on-white preview of its shape.
    await expect(options.locator("svg path")).toHaveCount(4);
    await options.filter({ hasText: name }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(trigger).toHaveAccessibleName(`Shape: ${name}`);
  }

  // Adding a second Shape leaves the Transform as it is.
  await addLayerDevice(page, "Transform", /^Shape/);
  await expect(shapeDevice(page)).toHaveCount(2);
  await expect(transformDevice(page)).toHaveCount(1);
});

const WIDTH = 200;
const HEIGHT = 100;

// A WIDTH×HEIGHT frame of one white fill clip on Layer 1, filling the
// canvas, with a Shape of `shape` on the layer and, when given, a
// Transform. Returns the RGBA of each point, in fractions of the frame from
// its top-left corner.
async function renderPoints(
  page: Page,
  shape: string,
  points: Array<[number, number]>,
  transform?: Record<string, number>,
) {
  return page.evaluate(
    async ({ shape, points, transform, width, height }) => {
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
            { key: "Color", value: "rgba(255,255,255,1)" },
            { key: "Opacity", value: "1", numericValue: 1 },
          ],
        },
        {
          id: "shape-1",
          trackId: "1",
          effectName: "Shape",
          enabled: true,
          parameters: [{ key: "Shape", value: shape }],
        },
      ];
      if (transform) {
        effects.push({
          id: "transform-1",
          trackId: "1",
          effectName: "Transform",
          enabled: true,
          parameters: Object.entries(transform).map(([key, value]) => ({
            key,
            value: String(value),
            numericValue: value,
          })),
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
        return points.map(([x, y]) => {
          const pixel = new Uint8Array(4);
          // readPixels counts rows from the bottom.
          gl.readPixels(
            Math.floor(x * width),
            height - 1 - Math.floor(y * height),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixel,
          );
          return Array.from(pixel);
        });
      } finally {
        renderer.destroy();
      }
    },
    { shape, points, transform, width: WIDTH, height: HEIGHT },
  ) as Promise<Rgba[]>;
}

const isWhite = ([red]: Rgba) => red > 230;
const isDark = ([red]: Rgba) => red < 25;

test.describe("Shape rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  // Points inside and outside each shape, stretched over the whole frame.
  const CASES: Array<
    [string, Array<[number, number]>, Array<[number, number]>]
  > = [
    [
      "Rectangle",
      [
        [0.5, 0.5],
        [0.01, 0.02],
        [0.99, 0.98],
      ],
      [],
    ],
    [
      "Oval",
      [
        [0.5, 0.5],
        [0.03, 0.5],
        [0.5, 0.05],
      ],
      [
        [0.05, 0.08],
        [0.95, 0.92],
      ],
    ],
    [
      "Star",
      [
        [0.5, 0.5],
        [0.5, 0.1],
      ],
      [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.5, 0.95],
      ],
    ],
    [
      "Arrow",
      [
        [0.1, 0.5],
        [0.95, 0.5],
        [0.62, 0.1],
      ],
      [
        [0.1, 0.1],
        [0.1, 0.9],
        [0.95, 0.15],
      ],
    ],
  ];
  for (const [shape, inside, outside] of CASES) {
    test(`${shape} keeps the layer inside it and clears it outside`, async ({
      page,
    }) => {
      const pixels = await renderPoints(page, shape, [...inside, ...outside]);
      inside.forEach((point, index) => {
        expect(isWhite(pixels[index]), `${point} inside`).toBe(true);
      });
      outside.forEach((point, index) => {
        expect(isDark(pixels[inside.length + index]), `${point} outside`).toBe(
          true,
        );
      });
    });
  }

  test("follows its Transform's box", async ({ page }) => {
    // An Oval in the right half of the frame: its box spans x 0.5..1.
    const [center, leftOfBox, boxCorner] = await renderPoints(
      page,
      "Oval",
      [
        [0.75, 0.5],
        [0.3, 0.5],
        [0.52, 0.05],
      ],
      { ScaleX: 0.5, PositionX: 0.25 },
    );
    expect(isWhite(center)).toBe(true);
    expect(isDark(leftOfBox)).toBe(true);
    expect(isDark(boxCorner)).toBe(true);
  });

  test("antialiases its edge", async ({ page }) => {
    // A row crossing an Oval's curved edge has partly covered pixels.
    const row = await renderPoints(
      page,
      "Oval",
      Array.from({ length: WIDTH }, (_, index) => [(index + 0.5) / WIDTH, 0.2]),
    );
    expect(row.some((pixel) => pixel[0] > 25 && pixel[0] < 230)).toBe(true);
  });
});
