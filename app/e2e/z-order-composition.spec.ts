import { expect, test } from "@playwright/test";

// Without an enabled Order effect the compositor doesn't arrange the layers:
// each one covers the whole canvas and Layer 1 is drawn last, on top. Two
// full-frame fill layers are rendered in real WebGL and the canvas center is
// sampled.

type Rgb = [number, number, number];

type Scenario = {
  layer1Opacity: number;
  order?: { arrangement: string; enabled: boolean; excludedLayers?: string };
};

// Layer 1 is red and Layer 2 blue. Returns the pixels at the top and the
// bottom quarter of the canvas.
async function render(
  page: import("@playwright/test").Page,
  scenario: Scenario,
) {
  return page.evaluate(async ({ layer1Opacity, order }) => {
    // A variable keeps TypeScript from resolving the dev server's path.
    const modulePath = "/src/CompositionPlayer.tsx";
    const { CompositionRenderer } = await import(/* @vite-ignore */ modulePath);
    const lanes = [
      { id: "1", name: "Layer 1", colorIndex: 0 },
      { id: "2", name: "Layer 2", colorIndex: 1 },
    ];
    const clips = lanes.map((lane) => ({
      id: `fill-${lane.id}`,
      kind: "fill",
      sourceSpanId: "",
      sourceTrackId: "",
      laneId: lane.id,
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
    }));
    const color = (laneId: string, value: string, opacity: number) => ({
      id: `color-${laneId}`,
      trackId: laneId,
      effectName: "Color",
      enabled: true,
      parameters: [
        { key: "Mode", value: "Solid" },
        { key: "Color", value },
        { key: "Opacity", value: String(opacity), numericValue: opacity },
      ],
    });
    const effects: unknown[] = [
      color("1", "#ff0000", layer1Opacity),
      color("2", "#0000ff", 1),
    ];
    if (order) {
      effects.push({
        id: "order",
        trackId: "__group_main",
        effectName: "Order",
        enabled: order.enabled,
        parameters: [
          { key: "Arrangement", value: order.arrangement },
          { key: "GridSize", value: "2", numericValue: 2 },
          { key: "Spacing", value: "0", numericValue: 0 },
          { key: "ExcludedLayers", value: order.excludedLayers ?? "" },
        ],
      });
    }

    const width = 90;
    const height = 160;
    const canvas = document.createElement("canvas");
    const renderer = new CompositionRenderer(
      {
        mediaItems: [],
        clips,
        lanes,
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
      const read = (yFromTop: number) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(
          width / 2,
          height - 1 - yFromTop,
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        return [pixel[0], pixel[1], pixel[2]];
      };
      return { top: read(height / 4), bottom: read((height * 3) / 4) };
    } finally {
      renderer.destroy();
    }
  }, scenario) as Promise<{ top: Rgb; bottom: Rgb }>;
}

function expectColor(actual: Rgb, expected: Rgb) {
  for (const [index, value] of expected.entries()) {
    expect(Math.abs(actual[index] - value), `rgb(${actual})`).toBeLessThan(8);
  }
}

test.beforeEach(async ({ page }) => {
  // Any page of the dev server can import the app's modules.
  await page.goto("/composition-smoke.html");
});

test("with no Order, Layer 1 covers the whole canvas on top", async ({
  page,
}) => {
  const { top, bottom } = await render(page, { layer1Opacity: 1 });
  expectColor(top, [255, 0, 0]);
  expectColor(bottom, [255, 0, 0]);
});

test("with no Order, a half-transparent Layer 1 blends over Layer 2", async ({
  page,
}) => {
  const { top, bottom } = await render(page, { layer1Opacity: 0.5 });
  expectColor(top, [128, 0, 127]);
  expectColor(bottom, [128, 0, 127]);
});

test("a bypassed Order overlaps the layers like no Order", async ({ page }) => {
  const { top, bottom } = await render(page, {
    layer1Opacity: 1,
    order: { arrangement: "Vertical", enabled: false },
  });
  expectColor(top, [255, 0, 0]);
  expectColor(bottom, [255, 0, 0]);
});

test("a Vertical Order stacks Layer 1 above Layer 2", async ({ page }) => {
  const { top, bottom } = await render(page, {
    layer1Opacity: 1,
    order: { arrangement: "Vertical", enabled: true },
  });
  expectColor(top, [255, 0, 0]);
  expectColor(bottom, [0, 0, 255]);
});

test("an Order draws an excluded Layer 1 full-frame on top", async ({
  page,
}) => {
  const { top, bottom } = await render(page, {
    layer1Opacity: 1,
    order: { arrangement: "Vertical", enabled: true, excludedLayers: "1" },
  });
  expectColor(top, [255, 0, 0]);
  expectColor(bottom, [255, 0, 0]);
});

test("an Order draws an excluded Layer 2 full-frame beneath the arranged Layer 1", async ({
  page,
}) => {
  // Layer 1 is the only arranged layer, so it fills the one slot, and
  // Layer 2 shows through it everywhere.
  const { top, bottom } = await render(page, {
    layer1Opacity: 0.5,
    order: { arrangement: "Vertical", enabled: true, excludedLayers: "2" },
  });
  expectColor(top, [128, 0, 127]);
  expectColor(bottom, [128, 0, 127]);
});
