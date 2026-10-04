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

// A layer's one clip, 0-4 s: a fill of a color, a text clip, or none.
type LayerContent = { fill: string } | { text: string; color: string } | null;

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
        const kind = "fill" in layer ? "fill" : "text";
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
          },
        ];
      });
      const content = layers.flatMap((layer, index) => {
        if (!layer) return [];
        const trackId = `${index + 1}`;
        return [
          "fill" in layer
            ? {
                id: `color-${trackId}`,
                trackId,
                effectName: "Color",
                enabled: true,
                parameters: [
                  { key: "Mode", value: "Solid" },
                  { key: "Color", value: layer.fill },
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

const RED: Rgb = [255, 0, 0];
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
