import { expect, type Page, test } from "@playwright/test";

// A Mask shows its layer only where its Target layer draws (Additive), or
// everywhere but there (Subtractive), by the Target's drawn pixels rather
// than its box: a fill masked by a text layer shows, or loses, the shape of
// the letters. The compositor the preview and the export share is driven in
// real WebGL and sampled.

type Rgb = [number, number, number];

type Effect = {
  id: string;
  trackId: string;
  effectName: string;
  enabled: boolean;
  parameters: Array<{ key: string; value: string; numericValue?: number }>;
};

// A layer's one clip, 0-4 s: a fill of a color or gradient, on a hidden
// layer when `hidden`, a text clip, an FX clip, or none.
type LayerContent =
  | { fill: string; hidden?: boolean }
  | { text: string; color: string }
  | "fx"
  | null;

type Scenario = {
  // Layers, from Layer 1 down.
  layers: LayerContent[];
  effects: Effect[];
  samples: Array<[number, number]>;
};

const SIZE = 120;

// Renders the layers at 1 s and returns the pixels at `samples`, fractions
// of the canvas from its top-left corner.
async function render(page: Page, scenario: Scenario) {
  return page.evaluate(
    async ({ layers, effects, samples, size }) => {
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
      const clips = layers.flatMap((layer, index) => {
        if (!layer) return [];
        const laneId = `${index + 1}`;
        const kind = layer === "fx" ? "fx" : "fill" in layer ? "fill" : "text";
        return [
          {
            id: `${kind}-${laneId}`,
            kind,
            sourceSpanId: "",
            sourceTrackId: "",
            laneId,
            label: kind,
            mediaPath: "",
            startQ: 0,
            durationSeconds: 4,
            trimStartSeconds: 0,
            sourceOffsetSeconds: 0,
            sourceWindowStartSeconds: 0,
            sourceWindowEndSeconds: 4,
            tint: "#000",
            accent: "#fff",
            ...(layer !== "fx" && "hidden" in layer && layer.hidden
              ? { hidden: true }
              : {}),
          },
        ];
      });
      const content = layers.flatMap((layer, index) => {
        if (!layer || layer === "fx") return [];
        const trackId = `${index + 1}`;
        return [
          "fill" in layer
            ? {
                id: `color-${trackId}`,
                trackId,
                effectName: "Color",
                enabled: true,
                parameters: [
                  layer.fill.includes("gradient")
                    ? { key: "Mode", value: "Gradient" }
                    : { key: "Mode", value: "Solid" },
                  layer.fill.includes("gradient")
                    ? { key: "Gradient", value: layer.fill }
                    : { key: "Color", value: layer.fill },
                  { key: "Opacity", value: "1", numericValue: 1 },
                ],
              }
            : {
                id: `text-${trackId}`,
                trackId,
                effectName: "Text",
                enabled: true,
                parameters: [
                  { key: "Text", value: layer.text },
                  { key: "FontFamily", value: "Inter" },
                  { key: "FontWeight", value: "Bold" },
                  { key: "FontSize", value: "900", numericValue: 900 },
                  { key: "Align", value: "Center" },
                  { key: "VerticalAlign", value: "Middle" },
                  { key: "FillMode", value: "Solid" },
                  { key: "Color", value: layer.color },
                ],
              },
        ];
      });

      const canvas = document.createElement("canvas");
      const renderer = new CompositionRenderer(
        {
          mediaItems: [],
          clips,
          lanes,
          effects: [...content, ...effects],
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

function mask(trackId: string, target: string, mode: string): Effect {
  return {
    id: `mask-${trackId}`,
    trackId,
    effectName: "Mask",
    enabled: true,
    parameters: [
      { key: "Target", value: target },
      { key: "Mode", value: mode },
    ],
  };
}

// An Order on the FX clip on Layer `laneId`, arranging the layers beneath
// it.
function order(laneId: string): Effect {
  return {
    id: `order-${laneId}`,
    trackId: `clip:fx-${laneId}`,
    effectName: "Order",
    enabled: true,
    parameters: [
      { key: "Arrangement", value: "Vertical" },
      { key: "GridSize", value: "2", numericValue: 2 },
      { key: "Spacing", value: "0", numericValue: 0 },
    ],
  };
}

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
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

// Layer 1 is a red fill, Layer 2 a blue "I" filling the canvas's height.
// The middle of the canvas is inside the letter's stem; left of it is inside
// the text's box, which spans the canvas, but no letter is drawn there.
const LAYERS: LayerContent[] = [
  { fill: "rgba(255,0,0,1)" },
  { text: "I", color: "rgba(0,0,255,1)" },
];
const IN_LETTER: [number, number] = [0.5, 0.5];
const OUTSIDE_LETTER: [number, number] = [0.12, 0.5];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("draws both layers as usual without a Mask", async ({ page }) => {
  // The red fill on top covers the letter.
  expectColors(
    await render(page, {
      layers: LAYERS,
      effects: [],
      samples: [IN_LETTER, OUTSIDE_LETTER],
    }),
    [RED, RED],
  );
});

test("shows a fill only inside the letters of an Additive Target", async ({
  page,
}) => {
  expectColors(
    await render(page, {
      layers: LAYERS,
      effects: [mask("1", "2", "Additive")],
      samples: [IN_LETTER, OUTSIDE_LETTER],
    }),
    // Outside the letter nothing is drawn, though the text's box is there.
    [RED, BACKGROUND],
  );
});

test("cuts the letters of a Subtractive Target out of a fill", async ({
  page,
}) => {
  expectColors(
    await render(page, {
      layers: LAYERS,
      effects: [mask("1", "2", "Subtractive")],
      samples: [IN_LETTER, OUTSIDE_LETTER],
    }),
    // The Target keeps drawing, so its letter shows through the cut.
    [BLUE, RED],
  );
});

test("a Target with no active clip hides an Additive layer and leaves a Subtractive one", async ({
  page,
}) => {
  const layers: LayerContent[] = [{ fill: "rgba(255,0,0,1)" }, null];
  expectColors(
    await render(page, {
      layers,
      effects: [mask("1", "2", "Additive")],
      samples: [IN_LETTER],
    }),
    [BACKGROUND],
  );
  expectColors(
    await render(page, {
      layers,
      effects: [mask("1", "2", "Subtractive")],
      samples: [IN_LETTER],
    }),
    [RED],
  );
});

// An FX clip's Order draws the layers beneath it into its own box, so a
// Mask and its Target can be drawn on different surfaces: the Target's
// pixels are taken from where they end up on the canvas.
test.describe("a Target across an FX clip's Order", () => {
  // Layer 2 is an FX clip arranging Layers 3 and 4 in Vertical bands, Layer
  // 3 in the top one.
  const TOP: [number, number] = [0.5, 0.25];
  const BOTTOM: [number, number] = [0.5, 0.75];

  test("masks a layer above the arrangement by a Target inside it", async ({
    page,
  }) => {
    expectColors(
      await render(page, {
        layers: [
          { fill: "rgba(255,0,0,1)" },
          "fx",
          { fill: "rgba(0,0,255,1)" },
          { fill: "rgba(0,255,0,1)" },
        ],
        effects: [order("2"), mask("1", "3", "Additive")],
        samples: [TOP, BOTTOM],
      }),
      // The red fill shows only over Layer 3's band.
      [RED, GREEN],
    );
  });

  test("masks a layer inside the arrangement by a Target above it", async ({
    page,
  }) => {
    // Layer 1, a half-transparent blue "I", is drawn on the canvas over the
    // arrangement, where Layer 3, a red fill in the top band, is cut by its
    // letter. Where it is cut, only the letter's blue shows over the
    // Order's black border.
    const layers: LayerContent[] = [
      { text: "I", color: "rgba(0,0,255,0.5)" },
      "fx",
      { fill: "rgba(255,0,0,1)" },
      { fill: "rgba(0,255,0,1)" },
    ];
    // In the top band, where the letter's stem begins and left of it.
    const samples: Array<[number, number]> = [
      [0.5, 0.35],
      [0.12, 0.35],
    ];
    const [cut, outside] = await render(page, {
      layers,
      effects: [order("2"), mask("3", "1", "Subtractive")],
      samples,
    });
    const [unmasked] = await render(page, {
      layers,
      effects: [order("2")],
      samples,
    });
    expectColors([outside], [RED]);
    // Unmasked, the letter's blue shows the red beneath it.
    expect(unmasked[0] - cut[0]).toBeGreaterThan(48);
  });
});

// A masked Target contributes its masked pixels to the layer it masks.
test.describe("chained masks", () => {
  // Layer 1 is a red fill masked by Layer 2, a blue "I" that Layer 3, a
  // green fill, cuts away.
  test("masks by a Target's masked pixels", async ({ page }) => {
    const layers: LayerContent[] = [
      { fill: "rgba(255,0,0,1)" },
      { text: "I", color: "rgba(0,0,255,1)" },
      { fill: "rgba(0,255,0,1)" },
    ];
    expectColors(
      await render(page, {
        layers,
        effects: [mask("1", "2", "Additive"), mask("2", "3", "Subtractive")],
        samples: [IN_LETTER, OUTSIDE_LETTER],
      }),
      // Layer 2 is cut away entirely by Layer 3's fill, so Layer 1 shows
      // nowhere and Layer 3's green shows through.
      [GREEN, GREEN],
    );
  });

  test("draws a cycle of masks without recursing forever", async ({ page }) => {
    // Each layer closing the cycle is drawn unmasked, so each is masked by
    // the other's own pixels.
    expectColors(
      await render(page, {
        layers: LAYERS,
        effects: [mask("1", "2", "Additive"), mask("2", "1", "Additive")],
        samples: [IN_LETTER, OUTSIDE_LETTER],
      }),
      [RED, BACKGROUND],
    );
  });
});

// On an FX clip, a Mask limits where the clip's effects apply: a Pixelate
// FX clip masked by an Oval pixelates only inside it (Additive), or only
// outside it (Subtractive).
test.describe("a Mask on an FX clip", () => {
  // Layer 1 is the FX clip, Layer 2 a hidden fill shaped to an oval
  // spanning the canvas, and Layer 3 a black-to-white gradient across it.
  const layers: LayerContent[] = [
    "fx",
    { fill: "rgba(255,255,255,1)", hidden: true },
    {
      fill: "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(255,255,255,1) 100%)",
    },
  ];
  const effects: Effect[] = [
    {
      id: "shape-2",
      trackId: "2",
      effectName: "Shape",
      enabled: true,
      parameters: [{ key: "Shape", value: "Oval" }],
    },
    {
      id: "pixelate-1",
      trackId: "clip:fx-1",
      effectName: "Pixelate",
      enabled: true,
      // Blocks an eighth of the canvas across: 15 px.
      parameters: [{ key: "_NumPixels", value: "1", numericValue: 1 }],
    },
  ];
  // Two points 11 px apart in one block, in the middle of the oval and in
  // its top-left corner, outside it. Unpixelated, the gradient differs
  // between them; pixelated, they are the same block.
  const samples: Array<[number, number]> = [
    [61.5 / SIZE, 0.5],
    [72.5 / SIZE, 0.5],
    [1.5 / SIZE, 0.05],
    [12.5 / SIZE, 0.05],
  ];
  // Whether the middle and the corner are pixelated.
  async function pixelated(page: Page, mode?: string) {
    const [a, b, c, d] = await render(page, {
      layers,
      effects: mode ? [...effects, mask("clip:fx-1", "2", mode)] : effects,
      samples,
    });
    const flat = (left: Rgb, right: Rgb) => Math.abs(left[0] - right[0]) <= 2;
    // Unpixelated, the gradient rises about 2 levels a pixel.
    for (const [left, right] of [
      [a, b],
      [c, d],
    ]) {
      expect(
        flat(left, right) || right[0] - left[0] > 12,
        `${left} ${right}`,
      ).toBe(true);
    }
    return [flat(a, b), flat(c, d)];
  }

  test("pixelates everywhere without a Mask", async ({ page }) => {
    expect(await pixelated(page)).toEqual([true, true]);
  });

  test("pixelates only inside an Additive Target", async ({ page }) => {
    expect(await pixelated(page, "Additive")).toEqual([true, false]);
  });

  test("pixelates only outside a Subtractive Target", async ({ page }) => {
    expect(await pixelated(page, "Subtractive")).toEqual([false, true]);
  });
});

// The Target menu offers every other layer, one at a time, and never the
// layer the Mask is on.
test("picks one other layer as the Target", async ({ page }) => {
  const layerHeader = page.locator('[data-layer-header-id="6"]');
  await expect(layerHeader).toBeVisible();
  const layerName = (await layerHeader.textContent()) ?? "";
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name: /^Mask/ })
    .click();

  const device = page.locator('section[aria-label="Mask"]');
  const target = device.getByRole("button", { name: "Target" });
  await expect(target).toHaveText("Target: None");
  await target.click();
  const options = page.getByRole("menuitemcheckbox");
  const names = await options.allTextContents();
  expect(names[0]).toBe("None");
  expect(names.length).toBeGreaterThan(1);
  for (const name of names.slice(1)) {
    expect(layerName).not.toContain(name.replace(/^\d+/, ""));
  }
  await expect(options.first()).toHaveAttribute("aria-checked", "true");

  const other = names[1].replace(/^\d+/, "");
  await options.nth(1).click();
  await expect(target).toHaveText(`Target: ${other}`);
  await target.click();
  await expect(
    page.getByRole("menuitemcheckbox", { checked: true }),
  ).toHaveCount(1);
  await expect(options.nth(1)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await expect(
    device.getByRole("button", { name: "Additive" }),
  ).toHaveAttribute("aria-pressed", "true");
});
