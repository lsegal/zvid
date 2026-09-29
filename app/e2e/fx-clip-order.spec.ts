import { expect, type Page, test } from "@playwright/test";

// An Order on an FX clip arranges every layer beneath the clip, for the
// clip's time range and inside its box, instead of the Global Order. The
// compositor the preview and the export share is driven in real WebGL and
// sampled; the timeline flow adds Order from an FX clip's add menu.

type Rgb = [number, number, number];

type Effect = {
  id: string;
  trackId: string;
  effectName: string;
  enabled: boolean;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
};

type Scenario = {
  // Layers, from Layer 1 down: a fill colour, or `fx` for an FX clip
  // "fx-<layer>" over 0-2 s. Fills last 0-4 s.
  layers: string[];
  effects: Effect[];
  playheadSeconds: number;
  samples: Array<[number, number]>;
  size?: number;
  // Parameters of the Global Vertical Order besides its arrangement.
  globalOrder?: Effect["parameters"];
};

// Renders the layers under a Global Vertical Order and returns the pixels at
// `samples`, fractions of the canvas from its top-left corner.
async function render(page: Page, scenario: Scenario) {
  return page.evaluate(
    async ({
      layers,
      effects,
      playheadSeconds,
      samples,
      size = 120,
      globalOrder: globalParameters = [],
    }) => {
      // A variable keeps TypeScript from resolving the dev server's path.
      const modulePath = "/src/CompositionPlayer.tsx";
      const { CompositionRenderer } = await import(
        /* @vite-ignore */ modulePath
      );
      const lanes = layers.map((_, index) => ({
        id: `${index + 1}`,
        name: `Layer ${index + 1}`,
        colorIndex: index,
      }));
      const clips = layers.map((layer, index) => {
        const laneId = `${index + 1}`;
        const fx = layer === "fx";
        const seconds = fx ? 2 : 4;
        return {
          id: `${fx ? "fx" : "fill"}-${laneId}`,
          kind: fx ? "fx" : "fill",
          sourceSpanId: "",
          sourceTrackId: "",
          laneId,
          label: layer,
          mediaPath: "",
          startQ: 0,
          durationSeconds: seconds,
          trimStartSeconds: 0,
          sourceOffsetSeconds: 0,
          sourceWindowStartSeconds: 0,
          sourceWindowEndSeconds: seconds,
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
      const globalOrder = {
        id: "order-global",
        trackId: "__group_main",
        effectName: "Order",
        enabled: true,
        parameters: [
          { key: "Arrangement", value: "Vertical" },
          ...globalParameters,
        ],
      };

      const canvas = document.createElement("canvas");
      const renderer = new CompositionRenderer(
        {
          mediaItems: [],
          clips,
          lanes,
          effects: [globalOrder, ...colors, ...effects],
          bpm: 120,
          canvasWidth: size,
          canvasHeight: size,
        },
        { canvas, audioAnalysis: "offline" },
      );
      try {
        // 120 BPM: two quarters a second.
        await renderer.renderFrameAt(playheadSeconds * 2, playheadSeconds);
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
    scenario,
  ) as Promise<Rgb[]>;
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

function order(trackId: string, arrangement: string) {
  return effect(`order-${trackId}`, trackId, "Order", {
    Arrangement: arrangement,
    GridSize: 2,
    Spacing: 0,
  });
}

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
const YELLOW: Rgb = [255, 255, 0];
const WHITE: Rgb = [255, 255, 255];
const CYAN: Rgb = [0, 255, 255];
// The default border of an Order, where it draws no layer.
const BLACK: Rgb = [0, 0, 0];

function expectColor(actual: Rgb, expected: Rgb) {
  for (const [index, value] of expected.entries()) {
    expect(Math.abs(actual[index] - value), `rgb(${actual})`).toBeLessThan(8);
  }
}

function expectColors(actual: Rgb[], expected: Rgb[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, color] of expected.entries()) {
    expectColor(actual[index], color);
  }
}

// Cell centres of a 2×2 grid, and of four Vertical bands.
const QUADRANTS: Array<[number, number]> = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];
const BANDS: Array<[number, number]> = [
  [0.5, 0.125],
  [0.5, 0.375],
  [0.5, 0.625],
  [0.5, 0.875],
];
const FOUR_FILLS = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];

test.describe("compositing", () => {
  test.beforeEach(async ({ page }) => {
    // Any page of the dev server can import the app's modules.
    await page.goto("/composition-smoke.html");
  });

  test("a Grid on an FX clip arranges the layers beneath it only during its range", async ({
    page,
  }) => {
    const scenario = {
      layers: ["fx", ...FOUR_FILLS],
      effects: [order("clip:fx-1", "Grid")],
    };
    const during = await render(page, {
      ...scenario,
      playheadSeconds: 1,
      samples: QUADRANTS,
    });
    expectColors(during, [RED, GREEN, BLUE, YELLOW]);

    // Once the FX clip ends the Global Vertical arranges them again.
    const after = await render(page, {
      ...scenario,
      playheadSeconds: 3,
      samples: BANDS,
    });
    expectColors(after, [RED, GREEN, BLUE, YELLOW]);
  });

  test("leaves the layers above the FX clip where the Global Order puts them", async ({
    page,
  }) => {
    const samples: Array<[number, number]> = [
      [0.5, 0.15],
      [0.25, 0.8],
      [0.75, 0.8],
    ];
    const pixels = await render(page, {
      layers: ["#ffffff", "fx", "#ff0000", "#0000ff"],
      effects: [order("clip:fx-2", "Horizontal")],
      playheadSeconds: 1,
      samples,
    });
    // Layer 1 keeps the top of three bands; beneath it Layers 3 and 4 are
    // two columns across the FX clip's box, the whole canvas.
    expectColors(pixels, [WHITE, RED, BLUE]);
  });

  test("nested FX clips each govern the layers below them", async ({
    page,
  }) => {
    const pixels = await render(page, {
      layers: ["fx", "#ff0000", "fx", "#00ff00", "#0000ff"],
      effects: [order("clip:fx-1", "Horizontal"), order("clip:fx-3", "Grid")],
      playheadSeconds: 1,
      samples: [
        [0.15, 0.5],
        [0.4, 0.25],
        [0.75, 0.25],
        [0.75, 0.75],
      ],
    });
    // Layer 1's Horizontal gives Layer 2 the first of three columns; Layer
    // 3's Grid puts Layers 4 and 5 in the top row of the whole box beneath,
    // its empty cells in its border colour.
    expectColors(pixels, [RED, GREEN, BLUE, BLACK]);
  });

  test("confines the arrangement to the FX clip's Transform box", async ({
    page,
  }) => {
    const pixels = await render(page, {
      layers: ["fx", "#ff0000", "#0000ff"],
      effects: [
        order("clip:fx-1", "Horizontal"),
        effect("box", "clip:fx-1", "Transform", { ScaleX: 0.5, ScaleY: 0.5 }),
      ],
      playheadSeconds: 1,
      samples: [
        [0.35, 0.5],
        [0.65, 0.5],
        [0.1, 0.5],
        [0.5, 0.1],
      ],
    });
    // Two columns inside the centred half-size box, nothing outside it but
    // the Global Order's border.
    expectColors(pixels, [RED, BLUE, BLACK, BLACK]);
  });

  test("runs the FX clip's other effects on the arranged result", async ({
    page,
  }) => {
    const invert = effect("invert", "clip:fx-1", "NegativeSplit", {
      _LowIntensity: 1,
      _HighIntensity: 1,
    });
    // Order after the inverting effect still arranges first.
    const pixels = await render(page, {
      layers: ["fx", ...FOUR_FILLS],
      effects: [invert, order("clip:fx-1", "Grid")],
      playheadSeconds: 1,
      samples: QUADRANTS,
    });
    expectColors(pixels, [CYAN, [255, 0, 255], YELLOW, BLUE]);
  });

  test("arranges the same at any output size", async ({ page }) => {
    const scenario = {
      layers: ["#ffffff", "fx", "#ff0000", "#0000ff"],
      effects: [
        order("clip:fx-2", "Grid"),
        effect("box", "clip:fx-2", "Transform", {
          ScaleX: 0.5,
          PositionX: 0.25,
        }),
      ],
      playheadSeconds: 1,
      // The top row of the grid in the right half, below Layer 1's band;
      // left of the box; Layer 1's band.
      samples: [
        [0.6, 0.4],
        [0.9, 0.4],
        [0.2, 0.4],
        [0.5, 0.1],
      ] as Array<[number, number]>,
    };
    const preview = await render(page, { ...scenario, size: 90 });
    const exported = await render(page, { ...scenario, size: 360 });
    expectColors(preview, [RED, BLUE, BLACK, WHITE]);
    expectColors(exported, preview);
  });
});

test.describe("Order border", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/composition-smoke.html");
  });

  // At 360 px a Spacing of 20 is a 6.7 px gap.
  const SIZE = 360;
  const spaced = (color?: string) => [
    { key: "Spacing", value: "20", numericValue: 20 },
    ...(color ? [{ key: "BorderColor", value: color }] : []),
  ];

  test("colours the gaps between layers black by default", async ({ page }) => {
    const pixels = await render(page, {
      layers: ["#ff0000", "#0000ff"],
      effects: [],
      globalOrder: spaced(),
      playheadSeconds: 1,
      size: SIZE,
      samples: [
        [0.5, 0.25],
        [0.5, 0.5],
        [0.5, 0.75],
      ],
    });
    expectColors(pixels, [RED, BLACK, BLUE]);
  });

  test("colours the gaps and empty grid cells with a custom border", async ({
    page,
  }) => {
    const pixels = await render(page, {
      layers: ["fx", "#ff0000", "#0000ff", "#ffff00"],
      effects: [
        effect("grid", "clip:fx-1", "Order", {
          Arrangement: "Grid",
          GridSize: 2,
          Spacing: 20,
          BorderColor: "rgba(0,255,0,1)",
        }),
      ],
      playheadSeconds: 1,
      size: SIZE,
      samples: [
        [0.25, 0.25],
        [0.5, 0.25],
        [0.5, 0.5],
        [0.75, 0.75],
      ],
    });
    // A slot, the gap beside it, the gaps' crossing and the empty fourth
    // cell.
    expectColors(pixels, [RED, GREEN, GREEN, GREEN]);

    const global = await render(page, {
      layers: ["#ff0000", "#0000ff"],
      effects: [],
      globalOrder: spaced("#00ffff"),
      playheadSeconds: 1,
      size: SIZE,
      samples: [[0.5, 0.5]],
    });
    expectColors(global, [CYAN]);
  });

  test("shows what is beneath an FX clip's Order through a transparent border", async ({
    page,
  }) => {
    const scenario = {
      layers: ["fx", "#ff0000", "#0000ff"],
      globalOrder: spaced("#ffffff"),
      playheadSeconds: 1,
      size: SIZE,
      // Layer 2's column, the gap between the columns.
      samples: [
        [0.25, 0.5],
        [0.5, 0.5],
      ] as Array<[number, number]>,
    };
    const fxOrder = (color: string) =>
      effect("columns", "clip:fx-1", "Order", {
        Arrangement: "Horizontal",
        Spacing: 20,
        BorderColor: color,
      });
    const transparent = await render(page, {
      ...scenario,
      effects: [fxOrder("rgba(255,0,255,0)")],
    });
    // The Global Order's white border is all that is beneath the FX clip.
    expectColors(transparent, [RED, WHITE]);

    const opaque = await render(page, {
      ...scenario,
      effects: [fxOrder("rgba(255,0,255,1)")],
    });
    expectColors(opaque, [RED, [255, 0, 255]]);
  });

  test("exports the border as the preview shows it", async ({ page }) => {
    const scenario = {
      layers: ["#ff0000", "#0000ff", "#ffff00"],
      effects: [
        effect("grid", "__group_main", "Order", {
          Arrangement: "Grid",
          GridSize: 2,
          Spacing: 50,
          BorderColor: "rgba(255,0,255,1)",
        }),
      ],
      playheadSeconds: 1,
      // A cell, the gap beside it and the empty fourth cell.
      samples: [
        [0.25, 0.25],
        [0.5, 0.25],
        [0.75, 0.75],
      ] as Array<[number, number]>,
    };
    const preview = await render(page, { ...scenario, size: 180 });
    const exported = await render(page, { ...scenario, size: 720 });
    expectColors(preview, [RED, [255, 0, 255], [255, 0, 255]]);
    expectColors(exported, preview);
  });
});

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

test("an FX clip's add menu offers Order", async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();

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
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert FX Clip" })
    .click();
  const clip = lane(page, "1").locator(".clip-card--fx");
  await expect(clip).toHaveCount(1);

  await page.getByRole("button", { name: "Add device to this clip" }).click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: /^Order / })
    .click();
  await expect(clip.locator("strong")).toHaveText("FX · Order");
});

// An Order on an FX clip only arranges the layers beneath it, so its Layers
// menu lists only those; the Global Order's menu lists every layer.
test("an FX clip's Order lists only the layers beneath it", async ({
  page,
}) => {
  await page.goto("/");
  // Layer 2 of the default session's three layers.
  await expect(lane(page, "5")).toBeVisible();

  const bounds = await lane(page, "5").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert FX Clip" })
    .click();
  await expect(lane(page, "5").locator(".clip-card--fx")).toHaveCount(1);

  await page.getByRole("button", { name: "Add device to this clip" }).click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: /^Order / })
    .click();

  const menuRows = page.getByRole("menu").getByRole("menuitemcheckbox");
  const clipOrder = page.locator(
    '.fx-chain [data-fx-divider="clip"] ~ section[aria-label="Order"]',
  );
  await clipOrder.locator(".fx-layers__trigger").click();
  await expect(menuRows).toHaveText(["3Layer 3"]);
  await page.keyboard.press("Escape");

  const globalOrder = page
    .locator('section[aria-label="Order"]')
    .filter({ hasNotText: "Arranges the layers" })
    .first();
  await globalOrder.locator(".fx-layers__trigger").click();
  await expect(menuRows).toHaveText(["1Layer 1", "2Layer 2", "3Layer 3"]);
});
