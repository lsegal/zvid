// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canvasBoxToFrame } from "./composition-transform.ts";
import { pass as bloom } from "./fx/effects/bloom/pass.ts";
import { pass as colorize } from "./fx/effects/colorize/pass.ts";
import { pass as gaussianBlur } from "./fx/effects/gaussian-blur/pass.ts";
import { pass as levels } from "./fx/effects/levels/pass.ts";
import { pass as motionBlur } from "./fx/effects/motion-blur/pass.ts";
import { params } from "./fx/pass-test-utils.ts";
import type { CompiledPass, PreparedEffectStep } from "./fx-shaders/chain.ts";
import type { EffectPass } from "./fx-shaders/types.ts";
import {
  bleedTextPlacement,
  chainBleed,
  NO_BLEED,
  padBox,
} from "./text-effect-bleed.ts";

// A step running `pass` with `values`, as the chain prepares it.
function step(
  pass: EffectPass,
  values: Record<string, number>,
): PreparedEffectStep {
  return {
    compiled: { pass } as CompiledPass,
    parameters: params(values),
  };
}

// A 400×100 text box at 1080p, one box pixel per output pixel.
const BOX = { x: 760, y: 490, width: 400, height: 100 };

describe("text effect bleed", () => {
  it("leaves the box alone for effects that draw each pixel in place", () => {
    assert.deepEqual(
      chainBleed([step(colorize, {}), step(levels, {})], BOX, 1),
      NO_BLEED,
    );
    const placement = {
      frame: canvasBoxToFrame(BOX, { width: 1920, height: 1080 }),
    };
    const kept = bleedTextPlacement(
      placement,
      BOX,
      [step(colorize, {})],
      { width: 1920, height: 1080 },
      1,
    );
    assert.equal(kept.placement, placement);
    assert.deepEqual(kept.grow, { x: 1, y: 1 });
  });

  it("pads a horizontal Motion Blur across by half its Distance", () => {
    const bleed = chainBleed(
      [step(motionBlur, { _Angle: 0, _Distance: 200 })],
      BOX,
      1,
    );
    assert.ok(bleed.x >= 100 && bleed.x <= 104, `x = ${bleed.x}`);
    assert.equal(bleed.y, 0);
  });

  it("pads a vertical Motion Blur up, scaled to the output", () => {
    const bleed = chainBleed(
      [step(motionBlur, { _Angle: 90, _Distance: 200 })],
      BOX,
      0.5,
    );
    assert.ok(bleed.x <= 1, `x = ${bleed.x}`);
    assert.ok(bleed.y >= 50 && bleed.y <= 54, `y = ${bleed.y}`);
  });

  it("pads a Gaussian Blur by its Radius on every side", () => {
    const bleed = chainBleed([step(gaussianBlur, { _Radius: 40 })], BOX, 1);
    assert.ok(bleed.x >= 40 && bleed.x <= 44, `x = ${bleed.x}`);
    assert.equal(bleed.y, bleed.x);
  });

  it("pads a Bloom by the glow's reach over the padded frame", () => {
    const bleed = chainBleed(
      [step(bloom, { _Radius: 1, _Intensity: 1 })],
      BOX,
      1,
    );
    // The glow reaches 12% of the padded frame's shorter side.
    const reach = 0.12 * (BOX.height + 2 * bleed.y);
    assert.ok(bleed.y >= reach && bleed.y <= reach + 4, `y = ${bleed.y}`);
    assert.deepEqual(
      chainBleed([step(bloom, { _Radius: 1, _Intensity: 0 })], BOX, 1),
      NO_BLEED,
    );
  });

  it("adds the spreads of a chain's passes", () => {
    const bleed = chainBleed(
      [
        step(motionBlur, { _Angle: 0, _Distance: 100 }),
        step(colorize, {}),
        step(gaussianBlur, { _Radius: 20 }),
      ],
      BOX,
      1,
    );
    assert.ok(bleed.x >= 70 && bleed.x <= 74, `x = ${bleed.x}`);
    assert.ok(bleed.y >= 20 && bleed.y <= 24, `y = ${bleed.y}`);
  });

  it("grows the frame around the box, keeping its center", () => {
    const canvas = { width: 1920, height: 1080 };
    const placement = { frame: canvasBoxToFrame(BOX, canvas), other: 1 };
    const bled = bleedTextPlacement(
      placement,
      BOX,
      [step(gaussianBlur, { _Radius: 40 })],
      canvas,
      1,
    );
    const bleed = chainBleed([step(gaussianBlur, { _Radius: 40 })], BOX, 1);
    assert.deepEqual(
      bled.placement.frame,
      canvasBoxToFrame(padBox(BOX, bleed), canvas),
    );
    assert.equal(bled.placement.other, 1);
    assert.ok(
      Math.abs(bled.placement.frame.centerX - placement.frame.centerX) < 1e-9,
    );
    assert.ok(
      Math.abs(bled.placement.frame.centerY - placement.frame.centerY) < 1e-9,
    );
    assert.equal(bled.grow.x, (BOX.width + 2 * bleed.x) / BOX.width);
    assert.equal(bled.grow.y, (BOX.height + 2 * bleed.y) / BOX.height);
  });
});
