import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GROUP_TRACK_ID,
  resolveVisualState,
  type SessionEffect,
} from "../../../composition-active-clips.ts";
import { resolveFillPaint } from "../../../fill-paint.ts";
import { resolveAnimatedEffects } from "../../../fx-animation.ts";
import { getAnimationDefaults } from "../../../fx-animation-defaults.ts";
import { getAnimationNeutralValues } from "../../../fx-animation-neutrals.ts";
import { getEffectDefinition } from "../../../fx-registry.ts";
import { clipEffectTrackId } from "../../../fx-stack.ts";
import { createEffect } from "../../stack/ops.ts";
import { OPACITY_EFFECT_NAME, parseOpacity } from "./opacity.ts";

const LANE = "lane";
const CLIP = "clip";
const CLIP_STACK = clipEffectTrackId(CLIP);

function opacity(trackId: string, value: number, id = trackId): SessionEffect {
  const effect = createEffect(trackId, OPACITY_EFFECT_NAME, id);
  return {
    ...effect,
    parameters: [
      { key: "Opacity", value: value.toFixed(3), numericValue: value },
    ],
  };
}

describe("Opacity definition", () => {
  it("is a 0–100% knob at 100% on layers, clips and FX clips", () => {
    const definition = getEffectDefinition(OPACITY_EFFECT_NAME);
    assert.deepEqual(definition.scopes, ["layer", "clip", "fxClip"]);
    assert.equal(definition.domain, undefined);
    assert.deepEqual(
      definition.parameters.map((parameter) =>
        parameter.kind === "number"
          ? [parameter.key, parameter.min, parameter.max, parameter.step]
          : [],
      ),
      [["Opacity", 0, 1, 0.01]],
    );
    assert.equal(definition.parameters[0].defaultValue, 1);
  });

  it("fades in from and out to nothing in Clip mode", () => {
    assert.deepEqual(getAnimationDefaults(OPACITY_EFFECT_NAME)?.modes, [
      "clip",
      "reactive",
      "lfo",
    ]);
    assert.deepEqual(getAnimationNeutralValues(OPACITY_EFFECT_NAME), {
      Opacity: { neutral: 0 },
    });
  });
});

describe("parseOpacity", () => {
  it("reads the knob, clamped to 0..1", () => {
    assert.equal(parseOpacity([{ key: "Opacity", value: "0.5" }]), 0.5);
    assert.equal(
      parseOpacity([{ key: "Opacity", value: "2", numericValue: 2 }]),
      1,
    );
    assert.equal(parseOpacity([{ key: "Opacity", value: "-1" }]), 0);
  });

  it("stays opaque without a readable value", () => {
    assert.equal(parseOpacity([]), 1);
    assert.equal(parseOpacity([{ key: "Opacity", value: "clear" }]), 1);
  });
});

describe("Opacity on a clip's and its layer's stacks", () => {
  const drawnAt = (effects: SessionEffect[]) =>
    resolveVisualState(effects, LANE, CLIP).opacity;

  it("hides at 0%, blends at 50% and leaves 100% as it was", () => {
    assert.equal(drawnAt([]), 1);
    assert.equal(drawnAt([opacity(CLIP_STACK, 1)]), 1);
    assert.equal(drawnAt([opacity(CLIP_STACK, 0.5)]), 0.5);
    assert.equal(drawnAt([opacity(CLIP_STACK, 0)]), 0);
    assert.equal(drawnAt([opacity(LANE, 0.5)]), 0.5);
    assert.equal(drawnAt([opacity(LANE, 0)]), 0);
  });

  it("fades the clip inside its layer, and each Opacity in a stack", () => {
    assert.equal(drawnAt([opacity(LANE, 0.5), opacity(CLIP_STACK, 0.5)]), 0.25);
    assert.equal(
      drawnAt([opacity(LANE, 0.5, "a"), opacity(LANE, 0.4, "b")]),
      0.2,
    );
  });

  it("composes with other effects' opacity, in either order", () => {
    const blend = {
      id: "blend",
      trackId: LANE,
      effectName: "Blend",
      parameters: [{ key: "Opacity", value: "0.5", numericValue: 0.5 }],
    };
    assert.equal(drawnAt([blend, opacity(CLIP_STACK, 0.5)]), 0.25);
    assert.equal(drawnAt([opacity(LANE, 0.5), blend]), 0.25);
  });

  it("skips bypassed devices and the Global stack", () => {
    assert.equal(drawnAt([{ ...opacity(CLIP_STACK, 0), enabled: false }]), 1);
    assert.equal(drawnAt([opacity(GROUP_TRACK_ID, 0)]), 1);
  });

  it("leaves a fill clip's Color opacity to its paint", () => {
    const color = createEffect(CLIP_STACK, "Color", "color");
    const effects = [
      {
        ...color,
        parameters: color.parameters.map((parameter) =>
          parameter.key === "Opacity"
            ? { ...parameter, value: "0.4", numericValue: 0.4 }
            : parameter,
        ),
      },
    ];
    assert.equal(drawnAt(effects), 1);
    assert.equal(resolveFillPaint(effects, LANE, CLIP_STACK).opacity, 0.4);
    assert.equal(drawnAt([...effects, opacity(CLIP_STACK, 0.5)]), 0.5);
    assert.equal(
      resolveFillPaint([...effects, opacity(CLIP_STACK, 0.5)], LANE, CLIP_STACK)
        .opacity,
      0.4,
    );
  });
});

describe("Opacity in Clip mode", () => {
  const frame = { playheadQ: 4, bpm: 120, fps: 30 };
  const at = (elapsedSeconds: number) => {
    const effect = {
      ...opacity(CLIP_STACK, 1),
      animation: createEffect(CLIP_STACK, OPACITY_EFFECT_NAME).animation,
    };
    assert.equal(effect.animation?.enabled, true);
    assert.equal(effect.animation?.mode, "clip");
    const effects = resolveAnimatedEffects(
      [effect],
      {
        clipId: CLIP,
        laneId: LANE,
        progress: elapsedSeconds / 4,
        elapsedSeconds,
        durationSeconds: 4,
        sessionEdges: { atStart: false, atEnd: false },
      },
      frame,
    );
    return resolveVisualState(effects, LANE, CLIP).opacity;
  };

  it("fades the clip in and out", () => {
    assert.equal(at(0), 0);
    const entering = at(0.1);
    assert.ok(entering > 0 && entering < 1, `${entering}`);
    assert.equal(at(2), 1);
    const leaving = at(3.9);
    assert.ok(leaving > 0 && leaving < 1, `${leaving}`);
  });
});
