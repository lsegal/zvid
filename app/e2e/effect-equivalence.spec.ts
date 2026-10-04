import { expect, type Page, test } from "@playwright/test";

// #951 made Bloom, Caustics and Refraction cheaper without changing how they
// look. Each test renders a frame in real WebGL with the current pass, then
// again with the pass as it was before (e2e/fixtures/reference-passes), and
// compares every pixel.

type Parameter = { key: string; value: string; numericValue?: number };

// Bright bars on dark, with colored stripes between, so there are hard
// edges for Bloom to glow from and for the refractions to bend.
const BARS =
  "linear-gradient(90deg, rgba(10,10,20,1) 0%, rgba(10,10,20,1) 20%, rgba(255,255,255,1) 20%, rgba(255,255,255,1) 26%, rgba(200,40,40,1) 26%, rgba(200,40,40,1) 45%, rgba(30,160,60,1) 45%, rgba(30,160,60,1) 52%, rgba(250,230,90,1) 52%, rgba(250,230,90,1) 58%, rgba(20,40,180,1) 58%, rgba(20,40,180,1) 80%, rgba(240,240,240,1) 80%, rgba(240,240,240,1) 83%, rgba(10,10,20,1) 83%, rgba(10,10,20,1) 100%)";

function numbers(values: Record<string, number>): Parameter[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    value: String(value),
    numericValue: value,
  }));
}

// Renders a `width`×`height` frame at `seconds` of one BARS fill clip on Layer
// 1 with `effectName` of `parameters` on the layer, first with the current
// pass and then with the reference pass, and returns how far apart they
// are: the mean and the 99th percentile of each pixel's largest channel
// difference.
async function compare(
  page: Page,
  folder: string,
  effectName: string,
  parameters: Parameter[],
  { seconds = 1, width = 320, height = 180 } = {},
) {
  return page.evaluate(
    async ({
      folder,
      effectName,
      parameters,
      seconds,
      paint,
      width,
      height,
    }) => {
      // Variables keep TypeScript from resolving the dev server's paths.
      const playerPath = "/src/CompositionPlayer.tsx";
      const passPath = `/src/fx/effects/${folder}/pass.ts`;
      const referencePath = `/e2e/fixtures/reference-passes/${folder}.ts`;
      const { CompositionRenderer } = await import(
        /* @vite-ignore */ playerPath
      );
      const { pass } = await import(/* @vite-ignore */ passPath);
      const { referencePass } = await import(/* @vite-ignore */ referencePath);

      async function render() {
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
                  { key: "Mode", value: "Gradient" },
                  { key: "Gradient", value: paint },
                  { key: "Opacity", value: "1", numericValue: 1 },
                ],
              },
              {
                id: "effect-1",
                trackId: "1",
                effectName,
                enabled: true,
                parameters,
              },
            ],
            bpm: 120,
            canvasWidth: width,
            canvasHeight: height,
          },
          { canvas, audioAnalysis: "offline" },
        );
        try {
          await renderer.renderFrameAt(seconds * 2, seconds);
          const gl = canvas.getContext("webgl");
          if (!gl) throw new Error("WebGL is unavailable.");
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixels;
        } finally {
          renderer.destroy();
        }
      }

      const current = await render();
      const saved = { ...pass };
      try {
        for (const key of Object.keys(pass)) delete pass[key];
        Object.assign(pass, referencePass);
        const reference = await render();
        const differences: number[] = [];
        for (let index = 0; index < current.length; index += 4) {
          let most = 0;
          for (let channel = 0; channel < 4; channel++) {
            most = Math.max(
              most,
              Math.abs(current[index + channel] - reference[index + channel]),
            );
          }
          differences.push(most);
        }
        differences.sort((a, b) => a - b);
        const mean =
          differences.reduce((sum, value) => sum + value, 0) /
          differences.length;
        const p99 = differences[Math.floor(differences.length * 0.99)];
        return { mean, p99 };
      } finally {
        for (const key of Object.keys(pass)) delete pass[key];
        Object.assign(pass, saved);
      }
    },
    {
      folder,
      effectName,
      parameters,
      seconds,
      paint: BARS,
      width,
      height,
    },
  );
}

// The frames match to within a level or so on average. BARS's hard edges
// let a shift of a fraction of a pixel change a pixel beside one a lot, so
// the 99th percentile allows more.
function expectSameLook({ mean, p99 }: { mean: number; p99: number }) {
  expect(mean).toBeLessThan(1.5);
  expect(p99).toBeLessThan(32);
}

test.describe("Cheaper effect passes look the same", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  for (const [label, values, tint] of [
    ["defaults", {}, undefined],
    ["a wide orange glow", { _Threshold: 0.3, _Radius: 1 }, "#ff8000"],
    ["a tight strong glow", { _Intensity: 2, _Radius: 0.15 }, undefined],
  ] as const) {
    test(`Bloom with ${label}`, async ({ page }) => {
      const parameters = numbers({
        _Threshold: 0.7,
        _Intensity: 0.6,
        _Radius: 0.4,
        ...values,
      });
      const result = await compare(
        page,
        "bloom",
        "Bloom",
        tint ? [...parameters, { key: "_Tint", value: tint }] : parameters,
        // Large enough that the glow reaches past BLOOM_TAPS pixels, where
        // the pass blurs at a fraction of the frame's size.
        { width: 960, height: 540 },
      );
      expectSameLook(result);
    });
  }

  for (const [label, values] of [
    ["defaults", {}],
    ["fine, strongly warped cells", { _Scale: 0, _Warp: 1, _Intensity: 1 }],
    ["coarse cells", { _Scale: 1, _Warp: 0.6 }],
  ] as const) {
    test(`Caustics with ${label}`, async ({ page }) => {
      const result = await compare(
        page,
        "caustics",
        "Caustics",
        numbers({ _Speed: 0.3, _Intensity: 0.5, _Scale: 0.5, ...values }),
        { seconds: 1.7 },
      );
      expectSameLook(result);
    });
  }

  for (const type of ["Water", "Frosted Glass"]) {
    for (const [label, values] of [
      ["defaults", {}],
      ["strong, fine and dispersed", { _Amount: 1, _Scale: 0, _Dispersion: 1 }],
    ] as const) {
      test(`Refraction ${type} with ${label}`, async ({ page }) => {
        const result = await compare(
          page,
          "refraction",
          "Refraction",
          [
            { key: "_Type", value: type },
            ...numbers({ _Amount: 0.3, _Scale: 0.5, _Speed: 0.6, ...values }),
          ],
          { seconds: 2.3 },
        );
        expectSameLook(result);
      });
    }
  }
});
