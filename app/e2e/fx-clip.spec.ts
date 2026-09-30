import { expect, type Page, test } from "@playwright/test";

// FX clips are adjustment clips: they draw nothing, and their own clip stack
// runs on everything composited beneath them, for their time range and
// within their box. The compositor is driven in real WebGL and sampled;
// the timeline flow inserts one from the selection menu.

type Rgb = [number, number, number];

type Effect = {
  id: string;
  trackId: string;
  effectName: string;
  enabled: boolean;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
};

type Scenario = {
  // Whether Layer 2 has an FX clip, over 0-2 s.
  fxClip: boolean;
  // Effects added to the fills' red and blue Color effects.
  effects: Effect[];
  playheadSeconds: number;
  samples: Array<[number, number]>;
};

// Layer 1 is a red fill over the top half of the canvas, Layer 3 a blue
// fill over the whole canvas, both 0-4 s. With `fxClip`, Layer 2 has an FX
// clip "fx-2" over 0-2 s. Returns the pixels at `samples`, fractions of the
// canvas from its top-left corner, and every pixel of the canvas.
async function render(page: Page, scenario: Scenario) {
  return page.evaluate(
    async ({ fxClip, effects, playheadSeconds, samples }) => {
      // A variable keeps TypeScript from resolving the dev server's path.
      const modulePath = "/src/CompositionPlayer.tsx";
      const { CompositionRenderer } = await import(
        /* @vite-ignore */ modulePath
      );
      const lanes = ["1", "2", "3"].map((id, index) => ({
        id,
        name: `Layer ${id}`,
        colorIndex: index,
      }));
      const clip = (
        id: string,
        kind: string,
        laneId: string,
        seconds: number,
      ) => ({
        id,
        kind,
        sourceSpanId: "",
        sourceTrackId: "",
        laneId,
        label: kind,
        mediaPath: "",
        startQ: 0,
        durationSeconds: seconds,
        trimStartSeconds: 0,
        sourceOffsetSeconds: 0,
        sourceWindowStartSeconds: 0,
        sourceWindowEndSeconds: seconds,
        tint: "#000",
        accent: "#fff",
      });
      const clips = [
        clip("fill-1", "fill", "1", 4),
        clip("fill-3", "fill", "3", 4),
        ...(fxClip ? [clip("fx-2", "fx", "2", 2)] : []),
      ];
      const color = (laneId: string, value: string) => ({
        id: `color-${laneId}`,
        trackId: laneId,
        effectName: "Color",
        enabled: true,
        parameters: [
          { key: "Mode", value: "Solid" },
          { key: "Color", value },
          { key: "Opacity", value: "1", numericValue: 1 },
        ],
      });
      const topHalf = {
        id: "transform-1",
        trackId: "1",
        effectName: "Transform",
        enabled: true,
        parameters: [
          { key: "ScaleY", value: "0.5", numericValue: 0.5 },
          { key: "PositionY", value: "-0.25", numericValue: -0.25 },
        ],
      };

      const width = 100;
      const height = 100;
      const canvas = document.createElement("canvas");
      const renderer = new CompositionRenderer(
        {
          mediaItems: [],
          clips,
          lanes,
          effects: [
            color("1", "#ff0000"),
            color("3", "#0000ff"),
            topHalf,
            ...effects,
          ],
          bpm: 120,
          canvasWidth: width,
          canvasHeight: height,
        },
        { canvas, audioAnalysis: "offline" },
      );
      try {
        // 120 BPM: two quarters a second.
        await renderer.renderFrameAt(playheadSeconds * 2, playheadSeconds);
        const gl = canvas.getContext("webgl");
        if (!gl) throw new Error("WebGL is unavailable.");
        const all = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, all);
        const pixels = samples.map(([x, y]) => {
          const offset =
            ((height - 1 - Math.floor(y * height)) * width +
              Math.floor(x * width)) *
            4;
          return [all[offset], all[offset + 1], all[offset + 2]];
        });
        return { pixels, all: Array.from(all) };
      } finally {
        renderer.destroy();
      }
    },
    scenario,
  ) as Promise<{ pixels: Rgb[]; all: number[] }>;
}

function effect(
  id: string,
  trackId: string,
  effectName: string,
  parameters: Record<string, string | number>,
): Effect {
  return {
    id,
    trackId,
    effectName,
    enabled: true,
    parameters: Object.entries(parameters).map(([key, value]) => ({
      key,
      value: String(value),
      ...(typeof value === "number" ? { numericValue: value } : {}),
    })),
  };
}

// Inverts every color: red becomes cyan and blue yellow.
const invert = effect("invert", "clip:fx-2", "NegativeSplit", {
  _LowIntensity: 1,
  _HighIntensity: 1,
});
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const YELLOW: Rgb = [255, 255, 0];

// The top left (Layer 1 over Layer 3), and the bottom left and right
// (Layer 3 alone).
const SAMPLES: Array<[number, number]> = [
  [0.25, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

function expectColor(actual: Rgb, expected: Rgb) {
  for (const [index, value] of expected.entries()) {
    expect(Math.abs(actual[index] - value), `rgb(${actual})`).toBeLessThan(8);
  }
}

test.describe("compositing", () => {
  test.beforeEach(async ({ page }) => {
    // Any page of the dev server can import the app's modules.
    await page.goto("/composition-smoke.html");
  });

  test("an FX clip without effects changes nothing", async ({ page }) => {
    const base = { effects: [], playheadSeconds: 1, samples: SAMPLES };
    const without = await render(page, { ...base, fxClip: false });
    const withEmpty = await render(page, { ...base, fxClip: true });
    expect(withEmpty.all).toEqual(without.all);
  });

  test("adjusts the layers beneath it only during its range", async ({
    page,
  }) => {
    const during = await render(page, {
      fxClip: true,
      effects: [invert],
      playheadSeconds: 1,
      samples: SAMPLES,
    });
    // Layer 1 is above the FX clip on Layer 2, so it stays red; Layer 3
    // beneath it is inverted.
    expectColor(during.pixels[0], RED);
    expectColor(during.pixels[1], YELLOW);
    expectColor(during.pixels[2], YELLOW);

    const after = await render(page, {
      fxClip: true,
      effects: [invert],
      playheadSeconds: 3,
      samples: SAMPLES,
    });
    expectColor(after.pixels[0], RED);
    expectColor(after.pixels[1], BLUE);
    expectColor(after.pixels[2], BLUE);
  });

  test("limits the adjustment to its Transform box", async ({ page }) => {
    const leftHalf = effect("box", "clip:fx-2", "Transform", {
      ScaleX: 0.5,
      PositionX: -0.25,
    });
    const { pixels } = await render(page, {
      fxClip: true,
      effects: [invert, leftHalf],
      playheadSeconds: 1,
      samples: SAMPLES,
    });
    expectColor(pixels[0], RED);
    expectColor(pixels[1], YELLOW);
    expectColor(pixels[2], BLUE);
  });

  test("takes no Order slot", async ({ page }) => {
    const order = effect("order", "__group_main", "Order", {
      Arrangement: "Vertical",
      GridSize: 2,
      Spacing: 0,
    });
    // A later identity Transform on Layer 1 wins, so each fill covers its
    // band.
    const fullBand = effect("transform-1b", "1", "Transform", {});
    const { pixels } = await render(page, {
      fxClip: true,
      effects: [invert, order, fullBand],
      playheadSeconds: 1,
      samples: SAMPLES,
    });
    // Two bands, Layer 1 on top and Layer 3 below, as without the FX clip;
    // only Layer 3 is beneath it.
    expectColor(pixels[0], RED);
    expectColor(pixels[1], YELLOW);
    expectColor(pixels[2], YELLOW);
  });
});

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function dragSelection(
  page: Page,
  laneId: string,
  fromX: number,
  toX: number,
) {
  const bounds = await lane(page, laneId).boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + fromX, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + (fromX + toX) / 2, y);
  await page.mouse.move(bounds.x + toX, y);
  await page.mouse.up();
}

test("Insert FX Clip adds an empty FX clip that lists its effects", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();

  await dragSelection(page, "1", 40, 260);
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert FX Clip" })
    .click();

  const clip = lane(page, "1").locator(".clip-card--fx");
  await expect(clip).toHaveCount(1);
  await expect(clip).toHaveClass(/clip-card--selected/);
  await expect(clip.locator(".clip-card__glyph")).toHaveText("FX");
  await expect(clip.locator("strong")).toHaveText("FX (empty)");
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  // The Clip section's add menu offers only effects that work on what is
  // beneath the clip.
  await page.getByRole("button", { name: "Add device to this clip" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Colorize" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Transform" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Order / })).toBeVisible();
  for (const name of ["Color", "Text", "Layout"]) {
    await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveCount(
      0,
    );
  }
  await menu.getByRole("menuitem", { name: "Colorize" }).click();
  await expect(clip.locator("strong")).toHaveText("FX · Colorize");
});
