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

// The spacing an Order with `spacing` and Full timing is drawn with,
// `elapsed` seconds into a clip of `duration`.
function spacingAt(spacing: number, elapsed: number, duration: number) {
  const parameters = resolveClipAnimatedParameters(
    {
      effectName: "Order",
      parameters: [
        { key: "Arrangement", value: "Horizontal" },
        { key: "Spacing", value: String(spacing), numericValue: spacing },
      ],
      animation: fullAnimation("Order"),
    },
    {
      clipId: "fx",
      laneId: "order",
      progress: elapsed / duration,
      elapsedSeconds: elapsed,
      durationSeconds: duration,
    },
    { playheadQ: 0, bpm: 120, fps: FPS },
  );
  return parseCompositionOrder(parameters).spacing;
}

describe("Full clip timing", () => {
  it("is offered in Clip mode after the fixed timings", () => {
    assert.deepEqual(CLIP_TIMINGS, ["Slow", "Normal", "Fast", "Full"]);
  });

  it("stretches each side to half the clip", () => {
    assert.equal(
      getClipTimingFrames("Order", "Full"),
      Number.POSITIVE_INFINITY,
    );
    assert.equal(getClipTimingFrames("Layout", "Full"), undefined);
  });

  it("eases Order spacing open until the middle of the clip and closed by its end", () => {
    assert.equal(spacingAt(108, 0, 3), 0);
    assertClose(spacingAt(108, 0.75, 3), 54);
    assertClose(spacingAt(108, 1.5, 3), 108);
    assertClose(spacingAt(108, 2.25, 3), 54);
    assertClose(spacingAt(108, 3, 3), 0);
    // Eased: slow at the start, so a quarter of the way in is below half.
    assert.ok(spacingAt(108, 0.375, 3) < 27);
  });

  it("follows the clip's length", () => {
    assertClose(spacingAt(80, 0.75, 1.5), 80);
    assertClose(spacingAt(80, 0.375, 1.5), 40);
  });

  it("snaps the Order's layers into their slots instead of sliding them", () => {
    assert.equal(resolveOrderSlide(fullAnimation("Order"), FPS), undefined);
    assert.ok(resolveOrderSlide(createDefaultAnimation("Order"), FPS));
  });

  it("is kept when a saved animation is read back", () => {
    const saved = JSON.parse(JSON.stringify(fullAnimation("Order")));
    assert.equal(normalizeEffectAnimation(saved, "Order")?.clip.timing, "Full");
  });
});

describe("Order spacing range", () => {
  it("reaches a tenth of a 1080p canvas", () => {
    assert.equal(SPACING_MAX, 108);
    const spacing = getEffectDefinition("Order").parameters.find(
      (parameter) => parameter.key === "Spacing",
    );
    assert.equal(spacing?.kind === "number" ? spacing.max : undefined, 108);
    assert.equal(
      parseCompositionOrder([
        { key: "Spacing", value: "108", numericValue: 108 },
      ]).spacing,
      108,
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
