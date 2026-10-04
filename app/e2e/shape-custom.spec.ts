import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// Shape ▸ Custom (#1008): an SVG imported as media masks a layer to its
// opaque area, stretched over the layer's box like the built-in shapes.

type Rgba = [number, number, number, number];

// Opaque in its left half only, in red: the mask is the alpha, not the
// color. Its square viewBox is stretched over whatever box it masks.
const LEFT_HALF_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
  '<rect x="0" y="0" width="5" height="10" fill="#f00"/></svg>';

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

async function addShape(page: Page) {
  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Transform", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Shape/ }).click();
}

// The preview's colors at points given in fractions of the canvas, read
// from a screenshot so the WebGL canvas needn't keep its drawing buffer.
async function previewColors(page: Page, points: Array<[number, number]>) {
  const png = await page
    .locator(".composition-player__canvas")
    .screenshot({ animations: "disabled" });
  return page.evaluate(
    async ({ data, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D context");
      context.drawImage(image, 0, 0);
      return points.map(([x, y]) =>
        Array.from(
          context.getImageData(
            Math.floor(image.width * x),
            Math.floor(image.height * y),
            1,
            1,
          ).data,
        ),
      );
    },
    { data: png.toString("base64"), points },
  ) as Promise<Rgba[]>;
}

const distance = (a: Rgba, b: Rgba) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

test("an imported SVG masks the layer through Shape ▸ Custom", async ({
  page,
}) => {
  const folder = mkdtempSync(join(tmpdir(), "zvid-shape-custom-"));
  try {
    const svgPath = join(folder, "half.svg");
    writeFileSync(svgPath, LEFT_HALF_SVG);

    await page.goto("/");
    await insertFillAtStart(page, "1");
    await addShape(page);
    const shape = page.locator('.fx-chain section[aria-label="Shape"]');
    await expect(shape).toHaveCount(1);

    // Without SVG media, Custom says how to get some.
    const trigger = shape.getByRole("button", { name: /^Shape: / });
    await trigger.click();
    const options = page.locator(".fx-shape__grid").getByRole("option");
    await expect(options).toHaveCount(5);
    await options.filter({ hasText: "Custom" }).click();
    await expect(page.getByText("Import an SVG as media")).toBeVisible();
    await page.keyboard.press("Escape");

    // Importing only an SVG adds it to the media and keeps the timeline.
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import Media" }).click();
    await (await choosing).setFiles(svgPath);
    await expect(page.getByText("Imported 1 media file.")).toBeVisible();
    await expect(lane(page, "1").locator(".clip-card--fill")).toHaveCount(1);
    await expect(page.locator(".track-label--source")).toHaveCount(0);

    await trigger.click();
    await options.filter({ hasText: "Custom" }).click();
    const svgOption = page
      .getByRole("listbox", { name: "SVG media" })
      .getByRole("option", { name: "half.svg" });
    // The option previews the SVG black on white.
    await expect(svgOption.locator(".fx-shape__custom-mask")).toHaveCount(1);
    await svgOption.click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(trigger).toHaveAccessibleName("Shape: Custom");
    await expect(trigger.locator(".fx-shape__custom-mask")).toHaveAttribute(
      "style",
      /mask-image: url\("blob:/,
    );

    // The new Shape's Transform is a square centered in the canvas, half its
    // height across: the SVG's opaque left half keeps the layer, its clear
    // right half and the canvas outside the box show the background.
    await page.mouse.move(0, 0);
    const canvasBox = await page
      .locator(".composition-player__canvas")
      .boundingBox();
    if (!canvasBox) throw new Error("No preview canvas");
    const halfWidth = (canvasBox.height / canvasBox.width) * 0.25;
    await expect
      .poll(async () => {
        const [left, right, outside] = await previewColors(page, [
          [0.5 - halfWidth / 2, 0.5],
          [0.5 + halfWidth / 2, 0.5],
          // Beside the box, clear of the Transform overlay's handles.
          [0.15, 0.5],
        ]);
        return [distance(left, outside) > 60, distance(right, outside) < 20];
      })
      .toEqual([true, true]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

const WIDTH = 200;
const HEIGHT = 100;

// A WIDTH×HEIGHT frame of a white fill on Layer 1 under Shape ▸ Custom with
// `svg` as its media, read at `points`, in fractions from the top-left.
async function renderCustomPoints(
  page: Page,
  svg: string,
  points: Array<[number, number]>,
) {
  return page.evaluate(
    async ({ svg, points, width, height }) => {
      // Variables keep TypeScript from resolving the dev server's paths.
      const playerPath = "/src/CompositionPlayer.tsx";
      const maskPath = "/src/fx/effects/shape/custom-mask.ts";
      const [{ CompositionRenderer }, { setShapeImageMedia }] =
        await Promise.all([
          import(/* @vite-ignore */ playerPath),
          import(/* @vite-ignore */ maskPath),
        ]);
      const url = URL.createObjectURL(
        new Blob([svg], { type: "image/svg+xml" }),
      );
      const media = {
        id: "svg-1",
        name: "mask.svg",
        kind: "image",
        durationSeconds: 0,
        hasAudio: false,
        hasVideo: false,
        color: "#000",
        accent: "#fff",
        previewUrl: url,
        availability: "ready",
      };
      setShapeImageMedia([media]);
      const canvas = document.createElement("canvas");
      const renderer = new CompositionRenderer(
        {
          mediaItems: [media],
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
          effects: [
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
              parameters: [{ key: "Shape", value: "Custom:mask.svg" }],
            },
          ],
          bpm: 120,
          canvasWidth: width,
          canvasHeight: height,
        },
        { canvas, audioAnalysis: "offline" },
      );
      try {
        // An exact frame waits for the SVG.
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
        setShapeImageMedia([]);
        URL.revokeObjectURL(url);
      }
    },
    { svg, points, width: WIDTH, height: HEIGHT },
  ) as Promise<Rgba[]>;
}

const isWhite = ([red]: Rgba) => red > 230;
const isDark = ([red]: Rgba) => red < 25;

test.describe("Shape ▸ Custom rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  test("keeps the layer where the SVG is opaque, stretched over the box", async ({
    page,
  }) => {
    // The square SVG is stretched over the 2:1 frame, so its left half
    // covers x 0..0.5 of the frame at every height.
    const pixels = await renderCustomPoints(page, LEFT_HALF_SVG, [
      [0.1, 0.1],
      [0.45, 0.9],
      [0.55, 0.1],
      [0.9, 0.9],
    ]);
    expect(isWhite(pixels[0])).toBe(true);
    expect(isWhite(pixels[1])).toBe(true);
    expect(isDark(pixels[2])).toBe(true);
    expect(isDark(pixels[3])).toBe(true);
  });

  test("ignores the SVG's own aspect ratio setting", async ({ page }) => {
    // A circle that would be letterboxed into the middle of the 2:1 frame
    // without stretching reaches the frame's left and right edges.
    const pixels = await renderCustomPoints(
      page,
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" preserveAspectRatio="xMidYMid meet"><circle cx="10" cy="10" r="10" fill="#00f"/></svg>',
      [
        [0.04, 0.5],
        [0.96, 0.5],
        [0.5, 0.5],
        [0.04, 0.05],
      ],
    );
    expect(isWhite(pixels[0])).toBe(true);
    expect(isWhite(pixels[1])).toBe(true);
    expect(isWhite(pixels[2])).toBe(true);
    expect(isDark(pixels[3])).toBe(true);
  });
});
