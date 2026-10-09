import { expect, type Page, test } from "@playwright/test";

// The film-look LUTs bundled with zvid (#1136): listed under "Built-in" in
// the LUT effect's picker, stored by a stable id, and read from the app's own
// public/luts/ files, so a session using one needs no imported media.

type Rgba = [number, number, number, number];

const BUILT_IN_NAMES = [
  "Black & White Film",
  "Sepia",
  "Faded Vintage Print",
  "Warm 70s Film",
  "Cool 90s Film",
  "Bleach Bypass",
  "Cross-Processed",
  "Two-Strip Color",
  "High-Contrast Film",
  "Teal & Orange",
];

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

// Sepia turns the default gray fill warm: red well above blue.
const isSepia = ([red, green, blue]: Rgba) =>
  red - blue > 25 && red > green && green > blue;
const isGray = ([red, green, blue]: Rgba) =>
  Math.max(red, green, blue) - Math.min(red, green, blue) < 6;

test("a built-in look grades the layer and survives a save and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page, "1");
  await page.mouse.move(0, 0);
  expect(isGray(await previewColor(page))).toBe(true);
  await addLut(page);
  const device = page.locator('.fx-chain section[aria-label="LUT"]');
  await expect(device).toHaveCount(1);

  // The picker lists every bundled look under Built-in, with no media.
  const trigger = device.getByRole("button", { name: /^LUT: / });
  await expect(trigger).toHaveAccessibleName("LUT: None");
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByText("Built-in", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox")).toHaveText([
    "None",
    ...BUILT_IN_NAMES,
  ]);
  await menu.getByRole("menuitemcheckbox", { name: "Sepia" }).click();
  await expect(trigger).toHaveAccessibleName("LUT: Sepia");

  await page.mouse.move(0, 0);
  await expect.poll(async () => isSepia(await previewColor(page))).toBe(true);

  // Another look grades the picture differently.
  await trigger.click();
  await page
    .getByRole("menu")
    .getByRole("menuitemcheckbox", { name: "Black & White Film" })
    .click();
  await expect(trigger).toHaveAccessibleName("LUT: Black & White Film");
  await page.mouse.move(0, 0);
  await expect.poll(async () => isGray(await previewColor(page))).toBe(true);
  await trigger.click();
  await page
    .getByRole("menu")
    .getByRole("menuitemcheckbox", { name: "Sepia" })
    .click();
  await page.mouse.move(0, 0);
  await expect.poll(async () => isSepia(await previewColor(page))).toBe(true);

  // Saved, closed and reopened from Sessions, it still has the look picked
  // and grading, without any LUT media.
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
  ).toHaveAccessibleName("LUT: Sepia");
  await page.mouse.move(0, 0);
  await expect.poll(async () => isSepia(await previewColor(page))).toBe(true);
});

test("an exact frame waits for a built-in look's file", async ({ page }) => {
  await page.goto("/export-smoke.html");
  const pixel = (await page.evaluate(async () => {
    // A variable keeps TypeScript from resolving the dev server's path.
    const playerPath = "/src/CompositionPlayer.tsx";
    const { CompositionRenderer } = await import(
      /* @vite-ignore */ playerPath
    );
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
        effects: [
          {
            id: "color-1",
            trackId: "1",
            effectName: "Color",
            enabled: true,
            parameters: [
              { key: "Mode", value: "Solid" },
              { key: "Color", value: "rgba(128,128,128,1)" },
              { key: "Opacity", value: "1", numericValue: 1 },
            ],
          },
          {
            id: "lut-1",
            trackId: "1",
            effectName: "LUT",
            enabled: true,
            parameters: [
              { key: "LUT", value: "builtin:sepia" },
              { key: "_Intensity", value: "1", numericValue: 1 },
            ],
          },
        ],
        bpm: 120,
        canvasWidth: 64,
        canvasHeight: 32,
      },
      { canvas, audioAnalysis: "offline" },
    );
    try {
      await renderer.renderFrameAt(1, 0.5);
      const gl = canvas.getContext("webgl");
      if (!gl) throw new Error("WebGL is unavailable.");
      const data = new Uint8Array(4);
      gl.readPixels(32, 16, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return Array.from(data);
    } finally {
      renderer.destroy();
    }
  })) as Rgba;
  // Sepia maps mid-gray halfway from its brown shadows to its cream
  // highlights: about (144, 129, 105).
  expect(isSepia(pixel), String(pixel)).toBe(true);
});
