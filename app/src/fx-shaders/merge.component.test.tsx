import { afterAll, describe, expect, test } from "vitest";
import { parameters } from "../component-test/fx-frames.ts";
import { EffectChainRenderer, type PreparedEffectStep } from "./chain.ts";
import { resolveEffectChain } from "./registry.ts";

// #994: the effect chain draws a pass and the per-pixel passes straight
// after it (Colorize, Negative Split) in one program. Each test renders a
// chain in real WebGL with merging on and off and compares every pixel.

type Effect = [string, Record<string, number>];

const WIDTH = 320;
const HEIGHT = 180;

// The effect chain on its own canvas, holding a frame of colored bars
// shaded toward black at the bottom. One serves every test in this file.
type Chain = {
  gl: WebGLRenderingContext;
  chain: EffectChainRenderer;
  texture: WebGLTexture;
};
let shared: Chain | undefined;

afterAll(() => {
  shared?.chain.dispose();
  shared?.gl.getExtension("WEBGL_lose_context")?.loseContext();
  shared = undefined;
});

function barsChain(): Chain {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
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
  paint.width = WIDTH;
  paint.height = HEIGHT;
  const context = paint.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable.");
  const colors = ["#0a0a14", "#fff", "#c82828", "#1ea03c", "#fae65a"];
  for (const [index, color] of colors.entries()) {
    context.fillStyle = color;
    context.fillRect((index * WIDTH) / 5, 0, WIDTH / 5, HEIGHT);
  }
  const shade = context.createLinearGradient(0, 0, 0, HEIGHT);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.8)");
  context.fillStyle = shade;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paint);
  for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
    gl.texParameteri(gl.TEXTURE_2D, name, gl.LINEAR);
  }
  for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) {
    gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE);
  }
  shared = { gl, chain: new EffectChainRenderer(gl, buffer), texture };
  return shared;
}

// The `effects` chain over the bars, with merging on and off: the steps
// each drew, and the mean and 99th percentile of the channel differences
// between them.
async function compare(effects: Effect[]) {
  const { gl, chain, texture } = barsChain();
  const steps = resolveEffectChain(
    effects.map(([effectName, values]) => ({
      trackId: "lane",
      effectName,
      parameters: parameters(values),
    })),
    "lane",
  );
  const render = (prepared: PreparedEffectStep[]) => {
    chain.run(
      { texture, uvScale: [1, 1], uvMax: [1, 1] },
      WIDTH,
      HEIGHT,
      prepared,
      { time: 1.5, clipProgress: 0.4, resolution: [1, 1], bottomUp: true },
      "screen",
    );
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
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

  const differences: number[] = [];
  let total = 0;
  for (let index = 0; index < merged.length; index++) {
    const difference = Math.abs(merged[index] - unmerged[index]);
    differences.push(difference);
    total += difference;
  }
  differences.sort((a, b) => a - b);
  return {
    separate: separate.length,
    merged: prepared.map((step) => step.compiled.pass.effectName),
    mean: total / merged.length,
    p99: differences[Math.floor(differences.length * 0.99)],
  };
}

// Between passes the merged shader rounds the color as an 8-bit target
// stores it, so only a few channels land a level apart, where float math
// puts a value on the other side of a rounding step. Negative Split's steep
// split at mid luma can turn one of those into a few levels, so the largest
// difference isn't checked.
function expectSameLook({ mean, p99 }: { mean: number; p99: number }) {
  expect(mean).toBeLessThan(0.1);
  expect(p99).toBeLessThanOrEqual(1);
}

const COLORIZE: Effect = ["Colorize", { _HueOffset: 0.3 }];
const NEGATIVE_SPLIT: Effect = [
  "NegativeSplit",
  { _LowIntensity: 0.4, _HighIntensity: 0.7 },
];

describe("Merged effect passes look the same", { timeout: 60_000 }, () => {
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
    test(`${lead[0]} then Colorize, Negative Split and Colorize`, async () => {
      const result = await compare([
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

  test("Bloom is drawn on its own, and the passes after it merged", async () => {
    const result = await compare([
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
