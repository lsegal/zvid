import { expect, type Page, test } from "@playwright/test";

// With an Order, a layer's Transform works inside the slot the Order gives
// it and is cropped to that slot: it never spills into a neighboring slot
// or the spacing between them. Without an Order the slot is the canvas. The
// compositor the preview and the export share is driven in real WebGL and
// sampled.

type Rgb = [number, number, number];

type Effect = {
  id: string;
  trackId: string;
  effectName: string;
  enabled: boolean;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
};

type Scenario = {
  // Layers, from Layer 1 down: a fill color, or `fx` for an FX clip
  // "fx-<layer>". Every clip lasts 0-4 s.
  layers: string[];
  effects: Effect[];
  samples: Array<[number, number]>;
  size?: number;
};

// Renders the layers at 1 s and returns the pixels at `samples`, fractions
// of the canvas from its top-left corner.
async function render(page: Page, scenario: Scenario) {
  return page.evaluate(async ({ layers, effects, samples, size = 120 }) => {
    // A variable keeps TypeScript from resolving the dev server's path.
    const modulePath = "/src/CompositionPlayer.tsx";
    const { CompositionRenderer } = await import(/* @vite-ignore */ modulePath);
    const lanes = layers.map((_, index) => ({
      id: `${index + 1}`,
      name: `Layer ${index + 1}`,
      colorIndex: index,
    }));
    const clips = layers.map((layer, index) => {
      const laneId = `${index + 1}`;
      const fx = layer === "fx";
      return {
        id: `${fx ? "fx" : "fill"}-${laneId}`,
        kind: fx ? "fx" : "fill",
        sourceSpanId: "",
        sourceTrackId: "",
        laneId,
        label: layer,
        mediaPath: "",
        startQ: 0,
        durationSeconds: 4,
        trimStartSeconds: 0,
        sourceOffsetSeconds: 0,
        sourceWindowStartSeconds: 0,
        sourceWindowEndSeconds: 4,
        tint: "#000",
        accent: "#fff",
      };
    });
    const colors = layers.flatMap((layer, index) =>
      layer === "fx"
        ? []
        : [
            {
              id: `color-${index + 1}`,
              trackId: `${index + 1}`,
              effectName: "Color",
              enabled: true,
              parameters: [
                { key: "Mode", value: "Solid" },
                { key: "Color", value: layer },
                { key: "Opacity", value: "1", numericValue: 1 },
              ],
            },
          ],
    );

    const canvas = document.createElement("canvas");
    const renderer = new CompositionRenderer(
      {
        mediaItems: [],
        clips,
        lanes,
        effects: [...colors, ...effects],
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
          ((size - 1 - Math.floor(y * size)) * size + Math.floor(x * size)) * 4;
        return [all[offset], all[offset + 1], all[offset + 2]];
      });
    } finally {
      renderer.destroy();
    }
  }, scenario) as Promise<Rgb[]>;
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

function order(trackId: string, arrangement: string, spacing = 0) {
  return effect(`order-${trackId}`, trackId, "Order", {
    Arrangement: arrangement,
    GridSize: 2,
    Spacing: spacing,
  });
}

const HORIZONTAL = order("__group_main", "Horizontal");

function transform(trackId: string, parameters: Record<string, number>) {
  return effect(`transform-${trackId}`, trackId, "Transform", parameters);
}

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
// An Order's default border, which fills its slots where no layer is drawn
// and the spacing between them.
const BORDER: Rgb = [0, 0, 0];

function expectColors(actual: Rgb[], expected: Rgb[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, color] of expected.entries()) {
    for (const [channel, value] of color.entries()) {
      expect(
        Math.abs(actual[index][channel] - value),
        `sample ${index}: rgb(${actual[index]})`,
      ).toBeLessThan(8);
    }
  }
}

test.describe("Order and Transform", () => {
  test.beforeEach(async ({ page }) => {
    // Any page of the dev server can import the app's modules.
    await page.goto("/composition-smoke.html");
  });

  test("crops a moved layer to its slot, leaving its neighbor's untouched, at any output size", async ({
    page,
  }) => {
    // Layer 1 moves right by 40% of the canvas and Layer 2, drawn after it,
    // left by as much: each keeps only the part still inside its own column.
    const scenario = {
      layers: ["#ff0000", "#0000ff"],
      effects: [
        HORIZONTAL,
        transform("1", { PositionX: 0.4 }),
        transform("2", { PositionX: -0.4 }),
      ],
      samples: [
        [0.2, 0.5],
        [0.45, 0.5],
        [0.55, 0.5],
        [0.8, 0.5],
      ] as Array<[number, number]>,
    };
    const expected = [BORDER, RED, BLUE, BORDER];
    expectColors(await render(page, { ...scenario, size: 90 }), expected);
    expectColors(await render(page, { ...scenario, size: 360 }), expected);
  });

  test("crops a scaled layer to its slot", async ({ page }) => {
    const pixels = await render(page, {
      layers: ["#ff0000", "#0000ff"],
      effects: [HORIZONTAL, transform("2", { ScaleX: 2, ScaleY: 2 })],
      samples: [
        [0.3, 0.5],
        [0.55, 0.5],
        [0.95, 0.5],
      ],
    });
    expectColors(pixels, [RED, BLUE, BLUE]);
  });

  test("crops a rotated layer to its slot", async ({ page }) => {
    const pixels = await render(page, {
      layers: ["#ff0000", "#0000ff"],
      effects: [HORIZONTAL, transform("2", { Rotation: 45 })],
      // Inside the turned column but left of its slot, then inside both.
      samples: [
        [0.45, 0.5],
        [0.75, 0.5],
      ],
    });
    expectColors(pixels, [RED, BLUE]);
  });

  test("keeps the spacing between slots to the border", async ({ page }) => {
    const pixels = await render(page, {
      layers: ["#ff0000", "#0000ff"],
      effects: [
        order("__group_main", "Horizontal", 50),
        transform("1", { ScaleX: 2, ScaleY: 2 }),
        transform("2", { ScaleX: 2, ScaleY: 2 }),
      ],
      samples: [
        [0.3, 0.5],
        [0.5, 0.5],
        [0.7, 0.5],
      ],
      size: 216,
    });
    expectColors(pixels, [RED, BORDER, BLUE]);
  });

  test("clips only to the canvas without an Order", async ({ page }) => {
    // The layers overlap full-frame; Layer 1, on top, moves half a canvas
    // right and still covers Layer 2 there.
    const pixels = await render(page, {
      layers: ["#ff0000", "#0000ff"],
      effects: [transform("1", { PositionX: 0.5 })],
      samples: [
        [0.25, 0.5],
        [0.75, 0.5],
      ],
    });
    expectColors(pixels, [BLUE, RED]);
  });

  test("crops layers an FX clip's Order arranges to their slots in its box", async ({
    page,
  }) => {
    const pixels = await render(page, {
      layers: ["fx", "#ff0000", "#0000ff"],
      effects: [
        order("clip:fx-1", "Horizontal"),
        transform("3", { PositionX: -0.4 }),
      ],
      samples: [
        [0.25, 0.5],
        [0.55, 0.5],
        [0.8, 0.5],
      ],
    });
    expectColors(pixels, [RED, BLUE, BORDER]);
  });
});
