import { expect, type Page, test } from "@playwright/test";

// #994: the effect chain draws a pass and the per-pixel passes straight
// after it (Colorize, Negative Split) in one program. Each test renders a
// chain in real WebGL with merging on and off and compares every pixel.

type Effect = [string, Record<string, number>];

const WIDTH = 320;
const HEIGHT = 180;

// The `effects` chain over a frame of colored bars, with merging on and
// off: the steps each drew, and the mean and largest channel difference
// between them.
async function compare(page: Page, effects: Effect[]) {
  return page.evaluate(
    async ({ effects, width, height }) => {
      // Variables keep TypeScript from resolving the dev server's paths.
      const chainPath = "/src/fx-shaders/chain.ts";
      const registryPath = "/src/fx-shaders/registry.ts";
      const { EffectChainRenderer } = await import(
        /* @vite-ignore */ chainPath
      );
      const { resolveEffectChain } = await import(
        /* @vite-ignore */ registryPath
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const gl = canvas.getContext("webgl");
      if (!gl) throw new Error("WebGL is unavailable.");
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );

      const paint = document.createElement("canvas");
      paint.width = width;
      paint.height = height;
      const context = paint.getContext("2d");
      if (!context) throw new Error("2D canvas is unavailable.");
      const colors = ["#0a0a14", "#fff", "#c82828", "#1ea03c", "#fae65a"];
      for (const [index, color] of colors.entries()) {
        context.fillStyle = color;
        context.fillRect((index * width) / 5, 0, width / 5, height);
      }
      const shade = context.createLinearGradient(0, 0, 0, height);
      shade.addColorStop(0, "rgba(0,0,0,0)");
      shade.addColorStop(1, "rgba(0,0,0,0.8)");
      context.fillStyle = shade;
      context.fillRect(0, 0, width, height);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        paint,
      );
      for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
        gl.texParameteri(gl.TEXTURE_2D, name, gl.LINEAR);
      }
      for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
        gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE);
      }

      const chain = new EffectChainRenderer(gl, buffer);
      const steps = resolveEffectChain(
        effects.map(([effectName, values]) => ({
          trackId: "lane",
          effectName,
          parameters: Object.entries(values).map(([key, value]) => ({
            key,
            value: String(value),
            numericValue: value,
          })),
        })),
        "lane",
      );
      const render = (prepared: unknown[]) => {
        chain.run(
          { texture, uvScale: [1, 1], uvMax: [1, 1] },
          width,
          height,
          prepared,
          { time: 1.5, clipProgress: 0.4, resolution: [1, 1], bottomUp: true },
          "screen",
        );
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };

      chain.mergePasses = false;
      const separate = chain.prepare(steps);
      const unmerged = render(separate);
      chain.mergePasses = true;
      // A merged program is used once the driver has compiled it.
      let prepared = chain.prepare(steps);
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(requestAnimationFrame);
        prepared = chain.prepare(steps);
        if (prepared.length < separate.length) break;
      }
      const merged = render(prepared);
      chain.dispose();

      let most = 0;
      let total = 0;
      for (let index = 0; index < merged.length; index++) {
        const difference = Math.abs(merged[index] - unmerged[index]);
        most = Math.max(most, difference);
        total += difference;
      }
      return {
        separate: separate.length,
        merged: prepared.map(
          (step: { compiled: { pass: { effectName: string } } }) =>
            step.compiled.pass.effectName,
        ),
        mean: total / merged.length,
        most,
      };
    },
    { effects, width: WIDTH, height: HEIGHT },
  );
}

// Between passes the merged shader rounds the color as an 8-bit target
// stores it, so only a few channels land a level or so apart, where float
// math puts a value on the other side of a rounding step.
function expectSameLook({ mean, most }: { mean: number; most: number }) {
  expect(mean).toBeLessThan(0.1);
  expect(most).toBeLessThanOrEqual(3);
}

const COLORIZE: Effect = ["Colorize", { _HueOffset: 0.3 }];
const NEGATIVE_SPLIT: Effect = [
  "NegativeSplit",
  { _LowIntensity: 0.4, _HighIntensity: 0.7 },
];

test.describe("Merged effect passes look the same", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  for (const lead of [
    ["Caustics", { _Intensity: 0.8, _Warp: 0.6 }],
    ["Refraction", { _Amount: 0.6 }],
    ["Distortion", { _Amount: 0.5 }],
    ["Pixelate", { _NumPixels: 0.4 }],
    ["DigitalGlitch", { _Amount: 0.7 }],
    ["AnalogGlitch", { _LowMod: 0.5, _HighMod: 0.6 }],
    ["ZoomAndPan", { _Start_Zoom: 0.3, _End_Zoom: 0.6, _End_X: 0.2 }],
    COLORIZE,
    NEGATIVE_SPLIT,
  ] as Effect[]) {
    test(`${lead[0]} then Colorize, Negative Split and Colorize`, async ({
      page,
    }) => {
      const result = await compare(page, [
        lead,
        COLORIZE,
        NEGATIVE_SPLIT,
        ["Colorize", { _HueOffset: -0.6 }],
      ]);
      expect(result.separate).toBe(4);
      expect(result.merged).toEqual([
        `${lead[0]} + Colorize + NegativeSplit + Colorize`,
      ]);
      expectSameLook(result);
    });
  }

  test("Bloom is drawn on its own, and the passes after it merged", async ({
    page,
  }) => {
    const result = await compare(page, [
      ["Bloom", { _Threshold: 0.5, _Intensity: 0.8, _Radius: 0.3 }],
      COLORIZE,
      NEGATIVE_SPLIT,
      ["Pixelate", { _NumPixels: 0.3 }],
      COLORIZE,
    ]);
    expect(result.merged).toEqual([
      "Bloom",
      "Colorize + NegativeSplit",
      "Pixelate + Colorize",
    ]);
    expectSameLook(result);
  });
});
