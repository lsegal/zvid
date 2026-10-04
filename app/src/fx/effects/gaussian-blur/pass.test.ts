// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnimationDefaults } from "../../../fx-animation-defaults.ts";
import {
  FX_EFFECT_DEFINITIONS,
  getEffectDefinition,
} from "../../../fx-registry.ts";
import type { EffectContext } from "../../../fx-shaders/types.ts";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { ALL_SCOPES } from "../../types.ts";
import {
  blurReads,
  GAUSSIAN_BLUR_MAX_RADIUS,
  GAUSSIAN_BLUR_TAPS,
  pass,
  sourceReadOffset,
} from "./pass.ts";

const stages = pass.stages ?? [];

type Rgba = [number, number, number, number];

// A bilinear read of a row of texels at `x`, in texels from the first one's
// center, clamped to the row's ends as the chain clamps every read.
function read(row: Rgba[], x: number): Rgba {
  const clamped = Math.min(Math.max(x, 0), row.length - 1);
  const left = Math.floor(clamped);
  const right = Math.min(left + 1, row.length - 1);
  const t = clamped - left;
  return row[left].map(
    (value, channel) => value * (1 - t) + row[right][channel] * t,
  ) as Rgba;
}

// One direction of the blur over a row, as its stage shader draws it with
// taps a texel apart out to `reach` texels.
function blurRow(row: Rgba[], reach: number) {
  return row.map((_, x) => {
    const sum: Rgba = [0, 0, 0, 0];
    for (const { offset, weight } of blurReads(reach)) {
      const reads =
        offset === 0
          ? [read(row, x)]
          : [read(row, x + offset), read(row, x - offset)];
      for (const texel of reads) {
        for (let channel = 0; channel < 4; channel++) {
          sum[channel] += weight * texel[channel];
        }
      }
    }
    return sum;
  });
}

// A row blurred as the pass does at full size: premultiplied, blurred, and
// divided by alpha again.
function blurStraightRow(row: Rgba[], reach: number) {
  const premultiplied = row.map(
    ([r, g, b, a]) => [r * a, g * a, b * a, a] as Rgba,
  );
  return blurRow(premultiplied, reach).map(
    ([r, g, b, a]) => (a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0]) as Rgba,
  );
}

function stageContext(
  resolution: [number, number],
  pixelScale: number,
  stageScale: number,
): EffectContext {
  return { ...CONTEXT, resolution, pixelScale, stageScale };
}

describe("Gaussian Blur pass", () => {
  it("has a Radius knob in pixels up to a strong blur", () => {
    const definition = getEffectDefinition("GaussianBlur");
    assert.equal(definition.displayName, "Gaussian Blur");
    assert.deepEqual(definition.scopes, ALL_SCOPES);
    const [radius] = definition.parameters;
    assert.equal(definition.parameters.length, 1);
    assert.equal(radius.key, "_Radius");
    assert.equal(radius.kind === "number" && radius.min, 0);
    assert.equal(radius.kind === "number" && radius.max, 100);
    assert.equal(radius.kind === "number" && radius.format(42), "42 px");
    assert.equal(GAUSSIAN_BLUR_MAX_RADIUS, 100);
  });

  it("sits beside Bloom in the add menus", () => {
    const names = FX_EFFECT_DEFINITIONS.map(
      (definition) => definition.effectName,
    );
    assert.equal(names.indexOf("GaussianBlur"), names.indexOf("Bloom") + 1);
  });

  it("is the identity at Radius 0", () => {
    assert.equal(pass.isIdentity?.(params({ _Radius: 0 })), true);
    assert.equal(pass.isIdentity?.(params({ _Radius: -5 })), true);
    assert.equal(pass.isIdentity?.(params({ _Radius: 0.5 })), false);
    assert.equal(pass.stageScale?.(params({ _Radius: 0 }), CONTEXT), 0);
    // With no reach the main shader passes the picture through without
    // reading the skipped stages.
    assert.deepEqual(uniformValues(pass, params({ _Radius: 0 })), {
      uReach: [0],
    });
    assert.match(
      pass.fragmentSource,
      /if \(uReach <= 0\.0\) \{\s*gl_FragColor = texture2D\(uTex, vUv\);\s*return;\s*\}/,
    );
  });

  it("is deterministic, reading neither time nor randomness", () => {
    for (const source of [pass, ...stages].map((s) => s.fragmentSource)) {
      assert.doesNotMatch(source, /uTime|random/i);
    }
    const parameters = params({ _Radius: 40 });
    for (const shader of [pass, ...stages]) {
      assert.deepEqual(
        uniformValues(shader, parameters),
        uniformValues(shader, parameters, {
          ...CONTEXT,
          time: 9,
          clipProgress: 0.9,
          bottomUp: true,
        }),
      );
    }
  });

  it("premultiplies, then blurs across and down", () => {
    assert.deepEqual(
      stages.map((stage) => stage.name),
      ["uBlurSource", "uBlurAcross", "uBlurDown"],
    );
    assert.match(stages[0].fragmentSource, /vec4\(c\.rgb \* c\.a, c\.a\)/);
    assert.match(stages[1].fragmentSource, /texture2D\(uBlurSource, /);
    assert.match(stages[2].fragmentSource, /texture2D\(uBlurAcross, /);
    assert.match(pass.fragmentSource, /texture2D\(uBlurDown, vUv\)/);
    assert.match(pass.fragmentSource, /blurred\.rgb \/ blurred\.a/);
  });

  it("blurs with normalized Gaussian weights, two taps per read", () => {
    for (const reach of [0.5, 3, 20, 32, GAUSSIAN_BLUR_TAPS]) {
      const [center, ...pairs] = blurReads(reach);
      assert.equal(center.offset, 0);
      assert.ok(pairs.length <= GAUSSIAN_BLUR_TAPS / 2);
      const total =
        center.weight + 2 * pairs.reduce((sum, { weight }) => sum + weight, 0);
      assert.ok(Math.abs(total - 1) < 1e-9);
      for (const [index, { offset, weight }] of pairs.entries()) {
        // Between its two taps, nearer the heavier inner one.
        assert.ok(offset >= 2 * index + 1 && offset < 2 * index + 1.5);
        assert.ok(weight > 0 && weight < center.weight * 2);
      }
    }
    // A long reach takes every pair; a tiny one is nearly the identity.
    assert.equal(
      blurReads(GAUSSIAN_BLUR_TAPS).length,
      GAUSSIAN_BLUR_TAPS / 2 + 1,
    );
    assert.ok(blurReads(0.1)[0].weight > 0.999);
  });

  it("spreads a single bright pixel into a symmetric falloff", () => {
    const row: Rgba[] = Array.from({ length: 81 }, (_, x) =>
      x === 40 ? [1, 1, 1, 1] : [0, 0, 0, 1],
    );
    const blurred = blurRow(row, 20).map(([r]) => r);
    // The light is kept, not lost or gained.
    const sum = blurred.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    for (let distance = 1; distance <= 40; distance++) {
      // The same on both sides, and fading with distance.
      assert.ok(
        Math.abs(blurred[40 - distance] - blurred[40 + distance]) < 1e-12,
      );
      assert.ok(blurred[40 + distance] <= blurred[40 + distance - 1]);
    }
    assert.ok(blurred[40] < 0.2);
    assert.ok(blurred[45] > 0);
    // It has faded out by the Radius, and stops a few pixels past it.
    assert.ok(blurred[60] < blurred[40] / 50);
    assert.equal(blurred[64], 0);
  });

  it("doesn't darken colors at the edge of transparent areas", () => {
    const row: Rgba[] = Array.from({ length: 60 }, (_, x) =>
      x < 30 ? [1, 0.5, 0.25, 1] : [0, 0, 0, 0],
    );
    const blurred = blurStraightRow(row, 12);
    for (const [r, g, b, a] of blurred) {
      if (a > 0) {
        assert.ok(Math.abs(r - 1) < 1e-9);
        assert.ok(Math.abs(g - 0.5) < 1e-9);
        assert.ok(Math.abs(b - 0.25) < 1e-9);
      }
    }
    // The edge fades out rather than stopping hard.
    assert.ok(blurred[29][3] < 1 && blurred[29][3] > 0.5);
    assert.ok(blurred[31][3] > 0 && blurred[31][3] < 0.5);
  });

  it("clamps at the picture's edges rather than wrapping", () => {
    const row: Rgba[] = Array.from({ length: 40 }, (_, x) =>
      x < 20 ? [1, 1, 1, 1] : [0, 0, 0, 1],
    );
    const blurred = blurRow(row, 10).map(([r]) => r);
    assert.ok(Math.abs(blurred[0] - 1) < 1e-9);
    assert.ok(Math.abs(blurred[39]) < 1e-9);
  });

  it("scales its Radius with the output size", () => {
    const scale = (radius: number, ctx: EffectContext) =>
      pass.stageScale?.(params({ _Radius: radius }), ctx);
    const output = (width: number, height: number) => ({
      ...CONTEXT,
      resolution: [width, height] as [number, number],
    });
    // A blur reaching under 32 pixels keeps full size.
    assert.equal(scale(20, output(1920, 1080)), 1);
    assert.equal(scale(40, output(960, 540)), 1);
    // A longer reach spans 32 stage texels: 64 pixels at
    // 1080p and 128 at 2160p take the same stage.
    assert.equal(scale(64, output(1920, 1080)), 0.5);
    assert.equal(scale(64, output(3840, 2160)), 0.25);
    // A picture smaller than the output, such as a layer in an Order slot,
    // is blurred by the output's pixels, not its own.
    assert.equal(scale(64, { ...output(640, 360), pixelScale: 1 }), 0.5);
    // The coarsest stage is a quarter of the picture.
    assert.equal(scale(100, output(3840, 2160)), 0.25);

    // The same Radius spans the same share of the picture at any size: a
    // 1080p frame's half-size stage and a 2160p frame's quarter-size one
    // are both 960×540, each texel two output pixels at 1080p across.
    const tap = (stageScale: number) =>
      uniformValues(
        stages[1],
        params({ _Radius: 64 }),
        stageContext([960, 540], 0.5, stageScale),
      ).uTap;
    assert.deepEqual(tap(0.5), [1 / 960, 0]);
    assert.deepEqual(tap(0.25), tap(0.5));
    assert.deepEqual(
      uniformValues(
        stages[2],
        params({ _Radius: 64 }),
        stageContext([960, 540], 0.5, 0.5),
      ).uTap,
      [0, 1 / 540],
    );
  });

  it("averages each stage texel's footprint of the picture", () => {
    // At full size the picture is read as it is.
    assert.equal(sourceReadOffset(1), 0);
    // Two or more pixels across, the four reads land a quarter of the way
    // in, where each bilinear read averages four pixels.
    assert.equal(sourceReadOffset(0.5), 0.5);
    assert.equal(sourceReadOffset(0.25), 1);
    const values = uniformValues(
      stages[0],
      [],
      stageContext([480, 270], 0.25, 0.25),
    );
    assert.deepEqual(values.uStep, [0.25 / 480, 0.25 / 270]);
  });

  it("supports the Animation modifier's Clip, Reactive and LFO modes", () => {
    assert.deepEqual(getAnimationDefaults("GaussianBlur")?.modes, [
      "clip",
      "reactive",
      "lfo",
    ]);
  });
});
