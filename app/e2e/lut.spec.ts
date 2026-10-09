import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// The LUT effect (#1135): a .cube file imported as media grades a layer
// through a 3D lookup table, blended in by Intensity.

type Rgba = [number, number, number, number];

// A 2-point LUT that inverts each channel.
const INVERT_CUBE = [
  'TITLE "Invert"',
  "LUT_3D_SIZE 2",
  "1 1 1",
  "0 1 1",
  "1 0 1",
  "0 0 1",
  "1 1 0",
  "0 1 0",
  "1 0 0",
  "0 0 0",
  "",
].join("\n");

// Every color to pure red, so the default gray fill visibly changes.
const RED_CUBE = ["LUT_3D_SIZE 2", ...Array(8).fill("1 0 0"), ""].join("\n");

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
  await seekToFill(page, laneId);
  await expect(fill).toHaveClass(/clip-card--selected/);
}

// Moves the playhead to the middle of the fill clip on layer `laneId`.
async function seekToFill(page: Page, laneId: string) {
  const clip = await lane(page, laneId)
    .locator(".clip-card--fill")
    .boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
}

async function addLut(page: Page) {
  await page.locator('[data-layer-header-id="1"]').click();
  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Color", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^LUT/ }).click();
}

async function importMedia(page: Page, path: string) {
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Media" }).click();
  await (await choosing).setFiles(path);
}

// The preview's color left of center, clear of the Transform overlay's
// handles, read from a screenshot so the WebGL canvas needn't keep its
// drawing buffer.
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
    return Array.from(
      context.getImageData(
        Math.floor(image.width * 0.3),
        Math.floor(image.height / 2),
        1,
        1,
      ).data,
    );
  }, png.toString("base64")) as Promise<Rgba>;
}

const isRed = ([red, green, blue]: Rgba) =>
  red > 240 && green < 15 && blue < 15;

test("an imported .cube grades the layer through LUT and survives a reload", async ({
  page,
}) => {
  const folder = mkdtempSync(join(tmpdir(), "zvid-lut-"));
  try {
    const cubePath = join(folder, "red.cube");
    writeFileSync(cubePath, RED_CUBE);
    const badPath = join(folder, "broken.cube");
    writeFileSync(badPath, "LUT_3D_SIZE 2\n0 0 0\n");

    await page.goto("/");
    await insertFillAtStart(page, "1");
    await page.mouse.move(0, 0);
    expect(isRed(await previewColor(page))).toBe(false);
    await addLut(page);
    const device = page.locator('.fx-chain section[aria-label="LUT"]');
    await expect(device).toHaveCount(1);
    await expect(device.getByText("Intensity")).toBeVisible();

    // Without LUT media, the picker says how to get some.
    const trigger = device.getByRole("button", { name: /^LUT: / });
    await expect(trigger).toHaveAccessibleName("LUT: None");
    await trigger.click();
    await expect(
      page.getByText("Import a .cube file as media to use it here."),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // A malformed file is turned away with the reason.
    await importMedia(page, badPath);
    await expect(
      page.getByText(
        /Skipped broken\.cube \(Not a valid \.cube LUT: .*8 points/,
      ),
    ).toBeVisible();

    // Importing only a LUT adds it to the media and keeps the timeline.
    await importMedia(page, cubePath);
    await expect(page.getByText("Imported 1 media file.")).toBeVisible();
    await expect(lane(page, "1").locator(".clip-card--fill")).toHaveCount(1);
    await expect(page.locator(".track-label--source")).toHaveCount(0);

    await trigger.click();
    await page.getByRole("menuitemcheckbox", { name: "red.cube" }).click();
    await expect(trigger).toHaveAccessibleName("LUT: red.cube");

    await page.mouse.move(0, 0);
    await expect.poll(async () => isRed(await previewColor(page))).toBe(true);

    // Saved, closed and reopened from Sessions, it still has the LUT picked
    // and grading from its media.
    await page.keyboard.press("ControlOrMeta+s");
    await expect(
      page.getByText("Saved Untitled Session to Sessions."),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "New Session" }).click();
    await expect(page.locator(".clip-card--fill")).toHaveCount(0);
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page
      .getByRole("complementary", { name: "Sessions" })
      .getByRole("list", { name: "Sessions" })
      .getByRole("button")
      .filter({ hasText: "Untitled Session" })
      .click();
    await expect(page.getByText("Opened Untitled Session.")).toBeVisible();
    await seekToFill(page, "1");
    await page.locator('[data-layer-header-id="1"]').click();
    await expect(
      page
        .locator('.fx-chain section[aria-label="LUT"]')
        .getByRole("button", { name: /^LUT: / }),
    ).toHaveAccessibleName("LUT: red.cube");
    await page.mouse.move(0, 0);
    await expect.poll(async () => isRed(await previewColor(page))).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

const WIDTH = 64;
const HEIGHT = 32;

// The center of a WIDTH×HEIGHT frame of a `color` fill on Layer 1 under
// LUT with `cube` as its media at `intensity`, as export renders it.
async function renderLut(
  page: Page,
  cube: string,
  color: string,
  intensity: number,
) {
  return page.evaluate(
    async ({ cube, color, intensity, width, height }) => {
      // Variables keep TypeScript from resolving the dev server's paths.
      const playerPath = "/src/CompositionPlayer.tsx";
      const lutPath = "/src/fx/effects/lut/lut-media.ts";
      const [{ CompositionRenderer }, { setLutMedia }] = await Promise.all([
        import(/* @vite-ignore */ playerPath),
        import(/* @vite-ignore */ lutPath),
      ]);
      const url = URL.createObjectURL(new Blob([cube]));
      const media = {
        id: "lut-1",
        name: "look.cube",
        kind: "lut",
        durationSeconds: 0,
        hasAudio: false,
        hasVideo: false,
        color: "#000",
        accent: "#fff",
        previewUrl: url,
        availability: "ready",
      };
      setLutMedia([media]);
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
                { key: "Color", value: color },
                { key: "Opacity", value: "1", numericValue: 1 },
              ],
            },
            {
              id: "lut-1",
              trackId: "1",
              effectName: "LUT",
              enabled: true,
              parameters: [
                { key: "LUT", value: "Custom:look.cube" },
                {
                  key: "_Intensity",
                  value: String(intensity),
                  numericValue: intensity,
                },
              ],
            },
          ],
          bpm: 120,
          canvasWidth: width,
          canvasHeight: height,
        },
        { canvas, audioAnalysis: "offline" },
      );
      try {
        // An exact frame waits for the LUT.
        await renderer.renderFrameAt(1, 0.5);
        const gl = canvas.getContext("webgl");
        if (!gl) throw new Error("WebGL is unavailable.");
        const pixel = new Uint8Array(4);
        gl.readPixels(
          width / 2,
          height / 2,
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        return Array.from(pixel);
      } finally {
        renderer.destroy();
        setLutMedia([]);
        URL.revokeObjectURL(url);
      }
    },
    { cube, color, intensity, width: WIDTH, height: HEIGHT },
  ) as Promise<Rgba>;
}

// Each output channel is the square of its input, over 17 points a side.
function squareCube() {
  const size = 17;
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        lines.push(
          [r, g, b].map((index) => (index / (size - 1)) ** 2).join(" "),
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

const near = (actual: Rgba, expected: number[], tolerance = 4) =>
  expected.every(
    (value, channel) => Math.abs(actual[channel] - value) <= tolerance,
  );

test.describe("LUT rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  test("maps colors through the LUT on the GPU, interpolating between points", async ({
    page,
  }) => {
    const inverted = await renderLut(
      page,
      INVERT_CUBE,
      "rgba(51,153,204,1)",
      1,
    );
    expect(near(inverted, [204, 102, 51]), String(inverted)).toBe(true);
    // 0.3 falls between the points at 0.25 and 0.3125: trilinear
    // interpolation lands within a step of 0.09.
    const squared = await renderLut(
      page,
      squareCube(),
      "rgba(77,128,230,1)",
      1,
    );
    const expected = [77, 128, 230].map((value) => (value / 255) ** 2 * 255);
    expect(near(squared, expected, 5), `${squared} vs ${expected}`).toBe(true);
  });

  test("blends by Intensity and leaves the picture at 0", async ({ page }) => {
    const color = "rgba(51,153,204,1)";
    expect(
      near(await renderLut(page, INVERT_CUBE, color, 0), [51, 153, 204]),
    ).toBe(true);
    expect(
      near(await renderLut(page, INVERT_CUBE, color, 0.5), [128, 128, 128]),
    ).toBe(true);
  });

  test("leaves the picture as it is for a malformed file", async ({ page }) => {
    const color = "rgba(51,153,204,1)";
    expect(
      near(
        await renderLut(page, "LUT_3D_SIZE 2\n0 0 0\n", color, 1),
        [51, 153, 204],
      ),
    ).toBe(true);
  });
});
