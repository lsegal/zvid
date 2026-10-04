import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The Hide switch on each layer and source track header (#1026): a hidden
// layer draws nothing and takes no Order slot, but can still be a Mask's
// Target, so a Shape layer can mask another without drawing itself. The
// compositor scenarios resolve their clips as the app does, through
// resolveRenderClips, and are rendered in real WebGL and sampled.

type Rgb = [number, number, number];

type Effect = {
  id: string;
  trackId: string;
  effectName: string;
  enabled: boolean;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
};

// A layer's one clip, 0-4 s: a fill of a color.
type Layer = { fill: string; hidden?: boolean };

type Scenario = {
  // Layers, from Layer 1 down.
  layers: Layer[];
  effects: Effect[];
  samples: Array<[number, number]>;
};

const SIZE = 120;

// Renders the layers at 1 s and returns the pixels at `samples`, fractions
// of the canvas from its top-left corner.
async function render(page: Page, scenario: Scenario) {
  return page.evaluate(
    async ({ layers, effects, samples, size }) => {
      // Variables keep TypeScript from resolving the dev server's paths.
      const playerPath = "/src/CompositionPlayer.tsx";
      const renderClipsPath = "/src/render-clips.ts";
      const { CompositionRenderer } = await import(
        /* @vite-ignore */ playerPath
      );
      const { resolveRenderClips } = await import(
        /* @vite-ignore */ renderClipsPath
      );
      const lanes = layers.map((layer, index) => ({
        id: `${index + 1}`,
        name: `Layer ${index + 1}`,
        colorIndex: index,
        ...(layer.hidden ? { hidden: true } : {}),
      }));
      const clips = layers.map((_, index) => ({
        id: `fill-${index + 1}`,
        kind: "fill",
        sourceSpanId: "",
        sourceTrackId: "",
        laneId: `${index + 1}`,
        label: "fill",
        mediaPath: "",
        startQ: 0,
        durationSeconds: 4,
        trimStartSeconds: 0,
        sourceOffsetSeconds: 0,
        sourceWindowStartSeconds: 0,
        sourceWindowEndSeconds: 4,
        tint: "#000",
        accent: "#fff",
      }));
      const colors = layers.map((layer, index) => ({
        id: `color-${index + 1}`,
        trackId: `${index + 1}`,
        effectName: "Color",
        enabled: true,
        parameters: [
          { key: "Mode", value: "Solid" },
          { key: "Color", value: layer.fill },
          { key: "Opacity", value: "1", numericValue: 1 },
        ],
      }));
      const rendered = resolveRenderClips({
        clips,
        lanes,
        sourceTracks: [],
        sourceSpans: [],
        bpm: 120,
        effects: [...colors, ...effects],
      });

      const canvas = document.createElement("canvas");
      const renderer = new CompositionRenderer(
        {
          mediaItems: [],
          clips: rendered.clips,
          lanes: rendered.lanes,
          effects: rendered.effects,
          bpm: 120,
          canvasWidth: size,
          canvasHeight: size,
        },
        { canvas, audioAnalysis: "offline" },
      );
      try {
        // 120 BPM: two quarters a second.
        await renderer.renderFrameAt(2, 1);
        const gl = canvas.getContext("webgl");
        if (!gl) throw new Error("WebGL is unavailable.");
        const all = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, all);
        return samples.map(([x, y]) => {
          const offset =
            ((size - 1 - Math.floor(y * size)) * size + Math.floor(x * size)) *
            4;
          return [all[offset], all[offset + 1], all[offset + 2]];
        });
      } finally {
        renderer.destroy();
      }
    },
    { ...scenario, size: SIZE },
  ) as Promise<Rgb[]>;
}

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const WHITE: Rgb = [255, 255, 255];
// What the composite shows where no layer is drawn.
const BACKGROUND: Rgb = [18, 20, 28];

function expectColors(actual: Rgb[], expected: Rgb[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, color] of expected.entries()) {
    for (const [channel, value] of color.entries()) {
      expect(
        Math.abs(actual[index][channel] - value),
        `sample ${index} channel ${channel}: ${actual[index]}`,
      ).toBeLessThanOrEqual(8);
    }
  }
}

const VERTICAL_ORDER: Effect = {
  id: "order",
  trackId: "__group_main",
  effectName: "Order",
  enabled: true,
  parameters: [
    { key: "Arrangement", value: "Vertical" },
    { key: "GridSize", value: "2", numericValue: 2 },
    { key: "Spacing", value: "0", numericValue: 0 },
    { key: "ExcludedLayers", value: "" },
  ],
};

const TOP: [number, number] = [0.5, 0.2];
const BOTTOM: [number, number] = [0.5, 0.8];
const CENTER: [number, number] = [0.5, 0.5];
const CORNER: [number, number] = [0.05, 0.05];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a hidden layer takes no Order slot and draws nothing", async ({
  page,
}) => {
  const layers = [{ fill: "rgba(255,0,0,1)" }, { fill: "rgba(0,0,255,1)" }];
  expectColors(
    await render(page, {
      layers,
      effects: [VERTICAL_ORDER],
      samples: [TOP, BOTTOM],
    }),
    [RED, BLUE],
  );
  // With Layer 1 hidden, Layer 2 has the whole canvas to itself.
  expectColors(
    await render(page, {
      layers: [{ ...layers[0], hidden: true }, layers[1]],
      effects: [VERTICAL_ORDER],
      samples: [TOP, BOTTOM],
    }),
    [BLUE, BLUE],
  );
});

test("a hidden Shape layer masks another layer without drawing itself", async ({
  page,
}) => {
  // Layer 1 is a red fill hidden inside Layer 2's oval, a white fill shaped
  // to an oval spanning the canvas: the middle shows what is beneath Layer
  // 1, and the corners, outside the oval, show Layer 1.
  const effects: Effect[] = [
    {
      id: "mask-1",
      trackId: "1",
      effectName: "Mask",
      enabled: true,
      parameters: [
        { key: "Target", value: "2" },
        { key: "Mode", value: "Subtractive" },
      ],
    },
    {
      id: "shape-2",
      trackId: "2",
      effectName: "Shape",
      enabled: true,
      parameters: [{ key: "Shape", value: "Oval" }],
    },
  ];
  const shape = { fill: "rgba(255,255,255,1)" };
  // Shown, the oval itself fills the middle.
  expectColors(
    await render(page, {
      layers: [{ fill: "rgba(255,0,0,1)" }, shape],
      effects,
      samples: [CENTER, CORNER],
    }),
    [WHITE, RED],
  );
  // Hidden, the oval still masks Layer 1, but nothing is drawn there.
  expectColors(
    await render(page, {
      layers: [{ fill: "rgba(255,0,0,1)" }, { ...shape, hidden: true }],
      effects,
      samples: [CENTER, CORNER],
    }),
    [BACKGROUND, RED],
  );
});

function header(page: Page, id: string) {
  return page.locator(`[data-layer-header-id="${id}"]`);
}

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

// The preview's color a quarter of the way in from its top-left corner, read
// from a screenshot so the WebGL canvas needn't keep its drawing buffer.
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

function difference(left: number[], right: number[]) {
  return Math.max(
    ...left.map((value, index) => Math.abs(value - right[index])),
  );
}

async function expectPreview(page: Page, expected: number[]) {
  await expect
    .poll(async () => difference(await previewColor(page), expected))
    .toBeLessThan(8);
}

test("the eye left of a layer's FX switch hides it in the preview, undoably", async ({
  page,
}) => {
  await insertFillAtStart(page, "1");
  await page.mouse.move(0, 0);
  const filled = await previewColor(page);

  const eye = header(page, "1").locator(".track-label__hide");
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expect(eye).toHaveAttribute("title", "Hide Layer 1");
  // It sits just left of the FX switch.
  const fx = header(page, "1").locator(".track-label__fx");
  const eyeBox = await eye.boundingBox();
  const fxBox = await fx.boundingBox();
  expect(eyeBox && fxBox && eyeBox.x + eyeBox.width <= fxBox.x + 1).toBe(true);

  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expect(eye).toHaveAttribute("title", "Show Layer 1");
  await expect(header(page, "1")).toContainText("Hidden");
  // Clicking the eye doesn't select the layer instead of the clip.
  await expect(lane(page, "1").locator(".clip-card--fill")).toHaveClass(
    /clip-card--selected/,
  );
  await page.mouse.move(0, 0);
  // Whatever is beneath the fill shows instead.
  await expect
    .poll(async () => difference(await previewColor(page), filled))
    .toBeGreaterThan(32);
  const hidden = await previewColor(page);

  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expect(header(page, "1")).not.toContainText("Hidden");
  await page.mouse.move(0, 0);
  await expectPreview(page, filled);

  // Each toggle is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expectPreview(page, hidden);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expectPreview(page, filled);
});

test("a source track's eye hides its video in the preview", async ({
  page,
}) => {
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceVideo(page);
  // With no layer clips, the preview renders the source tracks.
  await expect(page.locator(".preview-monitor")).toHaveAttribute(
    "data-render-source",
    "source-tracks",
  );
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  const label = page.locator(".track-label--source");
  const eye = label.locator(".track-label__hide");
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await page.mouse.move(0, 0);
  const shown = await previewColor(page);

  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expect(eye).toHaveAttribute("title", "Show test-pattern");
  await expect(label).toContainText("Hidden");
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(await previewColor(page), shown))
    .toBeGreaterThan(32);

  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expect(label).not.toContainText("Hidden");
  await page.mouse.move(0, 0);
  await expectPreview(page, shown);
});

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// Drops the test pattern into a new source track.
async function addSourceVideo(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// The page color at a point, read from a one-pixel screenshot.
async function colorAt(page: Page, x: number, y: number) {
  const png = await page.screenshot({
    clip: { x, y, width: 1, height: 1 },
    animations: "disabled",
  });
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
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2]];
  }, png.toString("base64"));
}

// The letterboxed video inside the monitor, in page coordinates.
async function videoRect(page: Page) {
  return page.locator(".composition-player__canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    const element = canvas as HTMLCanvasElement;
    const fit = Math.min(
      bounds.width / element.width,
      bounds.height / element.height,
    );
    const width = element.width * fit;
    const height = element.height * fit;
    return {
      left: bounds.left + (bounds.width - width) / 2,
      top: bounds.top + (bounds.height - height) / 2,
      width,
      height,
    };
  });
}

async function addLayerFx(page: Page, laneId: string, name: RegExp) {
  await header(page, laneId).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name })
    .click();
}

test("a hidden Mask Target keeps its box in the preview, and dragging it moves the mask (#1030)", async ({
  page,
}) => {
  // A new session's Order slides each layer in as its clip starts; hold it
  // still so the layers are in place at the playhead.
  await page
    .getByRole("button", { name: "Turn Animation Off for Order" })
    .click();
  await insertFillAtStart(page, "1");
  await insertFillAtStart(page, "2");
  // Layer 2 is a Shape, a centered square, hidden; Layer 1 cuts it out.
  await addLayerFx(page, "2", /^Shape/);
  await header(page, "2").locator(".track-label__hide").click();
  await expect(header(page, "2")).toContainText("Hidden");
  await addLayerFx(page, "1", /^Mask/);
  const mask = page.locator('section[aria-label="Mask"]');
  await mask.getByRole("button", { name: "Target" }).click();
  await page.getByRole("menuitemcheckbox", { name: /Layer 2/ }).click();
  await mask.getByRole("button", { name: "Subtractive" }).click();

  const video = await videoRect(page);
  const at = (x: number, y: number) => ({
    x: video.left + video.width * x,
    y: video.top + video.height * y,
  });
  const sample = async (x: number, y: number) => {
    const point = at(x, y);
    return colorAt(page, point.x, point.y);
  };
  await page.mouse.move(0, 0);
  // The square cuts a hole in Layer 1, but draws nothing there itself.
  await expect
    .poll(async () => difference(await sample(0.5, 0.5), BACKGROUND))
    .toBeLessThan(8);
  const filled = await sample(0.85, 0.5);
  expect(difference(filled, BACKGROUND)).toBeGreaterThan(32);

  // Selecting the hidden layer's clip outlines its box.
  const outline = page.getByTestId("preview-transform-outline");
  await lane(page, "2").locator(".clip-card--fill").click();
  await expect(outline).toHaveCount(1);

  // Dragging it, clear of the origin marker, moves the hole.
  const grab = at(0.5, 0.35);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + video.width * 0.15, grab.y, { steps: 4 });
  await page.mouse.move(grab.x + video.width * 0.3, grab.y, { steps: 4 });
  await page.mouse.up();
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(2);
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => difference(await sample(0.5, 0.5), filled))
    .toBeLessThan(8);
  // The moved square still draws nothing.
  await expect
    .poll(async () => difference(await sample(0.8, 0.5), BACKGROUND))
    .toBeLessThan(8);
});
