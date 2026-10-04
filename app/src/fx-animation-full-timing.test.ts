import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveVisualState } from "./composition-active-clips.ts";
import { parseCompositionOrder, SPACING_MAX } from "./composition-order.ts";
import {
  resolveClipAnimatedParameters,
  resolveOrderSlide,
} from "./fx-animation-clip.ts";
import {
  CLIP_TIMINGS,
  createDefaultAnimation,
  type EffectAnimation,
  getClipTimingFrames,
  getClipTimings,
  normalizeEffectAnimation,
} from "./fx-animation-defaults.ts";
import { getEffectDefinition } from "./fx-registry.ts";

const FPS = 30;

function assertClose(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
}

function fullAnimation(effectName: string): EffectAnimation {
  const animation = createDefaultAnimation(effectName);
  assert.ok(animation);
  return {
    ...animation,
    clip: { motionIn: "Ease In Out", motionOut: "Ease In Out", timing: "Full" },
  };
}

// Transform's ScaleX with Full timing, `elapsed` seconds into a clip of
// `duration`, when it is set to `scale`.
function scaleAt(scale: number, elapsed: number, duration: number) {
  const [parameter] = resolveClipAnimatedParameters(
    {
      effectName: "Transform",
      parameters: [
        { key: "ScaleX", value: String(scale), numericValue: scale },
      ],
      animation: fullAnimation("Transform"),
    },
    {
      clipId: "clip",
      laneId: "layer",
      progress: elapsed / duration,
      elapsedSeconds: elapsed,
      durationSeconds: duration,
    },
    { playheadQ: 0, bpm: 120, fps: FPS },
  );
  return parameter.numericValue ?? Number.NaN;
}

describe("Full clip timing", () => {
  it("is offered in Clip mode after the fixed timings", () => {
    assert.deepEqual(CLIP_TIMINGS, ["Slow", "Normal", "Fast", "Full"]);
    assert.deepEqual(getClipTimings("Transform"), CLIP_TIMINGS);
  });

  it("stretches each side to half the clip", () => {
    assert.equal(
      getClipTimingFrames("Transform", "Full"),
      Number.POSITIVE_INFINITY,
    );
    assert.equal(getClipTimingFrames("Layout", "Full"), undefined);
  });

  it("eases an effect in until the middle of the clip and out by its end", () => {
    assert.equal(scaleAt(3, 0, 3), 1);
    assertClose(scaleAt(3, 0.75, 3), 2);
    assertClose(scaleAt(3, 1.5, 3), 3);
    assertClose(scaleAt(3, 2.25, 3), 2);
    assertClose(scaleAt(3, 3, 3), 1);
    // Eased: slow at the start, so a quarter of the way in is below half.
    assert.ok(scaleAt(3, 0.375, 3) < 1.5);
  });

  it("follows the clip's length", () => {
    assertClose(scaleAt(3, 0.75, 1.5), 3);
    assertClose(scaleAt(3, 0.375, 1.5), 2);
  });

  it("is kept when a saved animation is read back", () => {
    const saved = JSON.parse(JSON.stringify(fullAnimation("Transform")));
    assert.equal(
      normalizeEffectAnimation(saved, "Transform")?.clip.timing,
      "Full",
    );
  });

  it("isn't offered on an Order, which doesn't animate itself", () => {
    assert.deepEqual(getClipTimings("Order"), ["Slow", "Normal", "Fast"]);
    const saved = JSON.parse(JSON.stringify(fullAnimation("Order")));
    const read = normalizeEffectAnimation(saved, "Order");
    assert.equal(read?.clip.timing, "Normal");
    assert.ok(resolveOrderSlide(read, FPS));
  });
});

describe("Order spacing range", () => {
  it("reaches 200 px at 1080p", () => {
    assert.equal(SPACING_MAX, 200);
    const spacing = getEffectDefinition("Order").parameters.find(
      (parameter) => parameter.key === "Spacing",
    );
    assert.equal(spacing?.kind === "number" ? spacing.max : undefined, 200);
    assert.equal(
      parseCompositionOrder([
        { key: "Spacing", value: "200", numericValue: 200 },
      ]).spacing,
      200,
    );
  });
});

describe("Move on an FX clip", () => {
  it("is offered on FX clips", () => {
    assert.ok(getEffectDefinition("Move").scopes.includes("fxClip"));
  });

  it("moves the FX clip's box from its start to its end placement", () => {
    const move = {
      id: "move",
      trackId: "clip:region",
      effectName: "Move",
      parameters: [
        { key: "Motion", value: "Linear" },
        { key: "StartPositionX", value: "-0.2", numericValue: -0.2 },
        { key: "EndPositionX", value: "0.2", numericValue: 0.2 },
        { key: "StartRotation", value: "-16", numericValue: -16 },
        { key: "EndRotation", value: "16", numericValue: 16 },
      ],
    };
    const transform = {
      id: "transform",
      trackId: "clip:region",
      effectName: "Transform",
      parameters: [
        { key: "ScaleX", value: "0.3", numericValue: 0.3 },
        { key: "ScaleY", value: "0.56", numericValue: 0.56 },
      ],
    };
    const visual = resolveVisualState(
      [move, transform],
      "fx-regions",
      "region",
      0.25,
    );
    assert.equal(visual.clipTransform?.scaleX, 0.3);
    const [outer] = visual.clipMotion?.outer ?? [];
    assert.ok(outer);
    assertClose(outer.positionX, -0.1);
    assertClose(outer.rotationDeg, -8);
  });
});
