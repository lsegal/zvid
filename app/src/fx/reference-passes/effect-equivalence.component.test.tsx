import { afterAll, describe, expect, test } from "vitest";
import { CompositionRenderer } from "../../CompositionPlayer.tsx";
import {
  fillState,
  layerEffect,
  type Parameter,
  parameters,
} from "../../component-test/fx-frames.ts";
import {
  type Frame,
  readCanvas,
  renderFrame,
} from "../../component-test/fx-render.ts";
import type { CompositionRendererState } from "../../composition-renderer-state.ts";
import type { EffectPass } from "../../fx-shaders/types.ts";
import { pass as bloomPass } from "../effects/bloom/pass.ts";
import { pass as causticsPass } from "../effects/caustics/pass.ts";
import { pass as refractionPass } from "../effects/refraction/pass.ts";
import { referencePass as bloomReference } from "./bloom.ts";
import { referencePass as causticsReference } from "./caustics.ts";
import { referencePass as refractionReference } from "./refraction.ts";

// #951 made Bloom, Caustics and Refraction cheaper without changing how they
// look. Each test renders a frame in real WebGL with the current pass, then
// again with the pass as it was before (the reference passes beside this
// file), and compares every pixel.

// Bright bars on dark, with colored stripes between, so there are hard
// edges for Bloom to glow from and for the refractions to bend.
const BARS =
  "linear-gradient(90deg, rgba(10,10,20,1) 0%, rgba(10,10,20,1) 20%, rgba(255,255,255,1) 20%, rgba(255,255,255,1) 26%, rgba(200,40,40,1) 26%, rgba(200,40,40,1) 45%, rgba(30,160,60,1) 45%, rgba(30,160,60,1) 52%, rgba(250,230,90,1) 52%, rgba(250,230,90,1) 58%, rgba(20,40,180,1) 58%, rgba(20,40,180,1) 80%, rgba(240,240,240,1) 80%, rgba(240,240,240,1) 83%, rgba(10,10,20,1) 83%, rgba(10,10,20,1) 100%)";

// The reference frames get a renderer of their own: a renderer keeps each
// pass's compiled program by the pass object, which the reference swaps in
// place, so the shared one would keep drawing the current pass. This one
// only ever draws while the reference is swapped in.
let referenceRenderer: CompositionRenderer | undefined;

afterAll(() => {
  referenceRenderer?.destroy();
  referenceRenderer = undefined;
});

async function renderReference(
  state: CompositionRendererState,
  seconds: number,
): Promise<Frame> {
  if (referenceRenderer) {
    referenceRenderer.update(state);
  } else {
    referenceRenderer = new CompositionRenderer(state, {
      canvas: document.createElement("canvas"),
      audioAnalysis: "offline",
    });
  }
  await referenceRenderer.renderFrameAt(seconds * 2, seconds);
  return readCanvas(referenceRenderer.canvas);
}

// Renders a `width`×`height` frame at `seconds` of one BARS fill clip on
// Layer 1 with `effectName` of `values` on the layer, first with the
// current `pass` and then with `reference` in its place, and returns how
// far apart they are: the mean and the 99th percentile of each pixel's
// largest channel difference.
async function compare(
  pass: EffectPass,
  reference: EffectPass,
  effectName: string,
  values: Parameter[],
  { seconds = 1, width = 320, height = 180 } = {},
) {
  const state = fillState(BARS, [layerEffect(effectName, values)], {
    width,
    height,
  });
  const current = (await renderFrame(state, seconds * 2, seconds)).pixels;
  const target = pass as unknown as Record<string, unknown>;
  const saved = { ...pass };
  let referencePixels: Uint8Array;
  try {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, reference);
    referencePixels = (await renderReference(state, seconds)).pixels;
  } finally {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, saved);
  }
  const differences: number[] = [];
  for (let index = 0; index < current.length; index += 4) {
    let most = 0;
    for (let channel = 0; channel < 4; channel++) {
      most = Math.max(
        most,
        Math.abs(current[index + channel] - referencePixels[index + channel]),
      );
    }
    differences.push(most);
  }
  differences.sort((a, b) => a - b);
  const mean =
    differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const p99 = differences[Math.floor(differences.length * 0.99)];
  return { mean, p99 };
}

// The frames match to within a level or so on average. BARS's hard edges
// let a shift of a fraction of a pixel change a pixel beside one a lot, so
// the 99th percentile allows more.
function expectSameLook({ mean, p99 }: { mean: number; p99: number }) {
  expect(mean).toBeLessThan(1.5);
  expect(p99).toBeLessThan(32);
}

describe("Cheaper effect passes look the same", { timeout: 60_000 }, () => {
  for (const [label, values, tint] of [
    ["defaults", {}, undefined],
    ["a wide orange glow", { _Threshold: 0.3, _Radius: 1 }, "#ff8000"],
    ["a tight strong glow", { _Intensity: 2, _Radius: 0.15 }, undefined],
  ] as const) {
    test(`Bloom with ${label}`, async () => {
      const numbers = parameters({
        _Threshold: 0.7,
        _Intensity: 0.6,
        _Radius: 0.4,
        ...values,
      });
      const result = await compare(
        bloomPass,
        bloomReference,
        "Bloom",
        tint ? [...numbers, { key: "_Tint", value: tint }] : numbers,
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
    test(`Caustics with ${label}`, async () => {
      const result = await compare(
        causticsPass,
        causticsReference,
        "Caustics",
        parameters({ _Speed: 0.3, _Intensity: 0.5, _Scale: 0.5, ...values }),
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
      test(`Refraction ${type} with ${label}`, async () => {
        const result = await compare(
          refractionPass,
          refractionReference,
          "Refraction",
          [
            { key: "_Type", value: type },
            ...parameters({
              _Amount: 0.3,
              _Scale: 0.5,
              _Speed: 0.6,
              ...values,
            }),
          ],
          { seconds: 2.3 },
        );
        expectSameLook(result);
      });
    }
  }
});
