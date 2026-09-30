// Clip mode of the Animation modifier: an effect animates in as each clip it
// is drawn for enters, over its Motion In curve and Timing, and back out as
// the clip exits, over its Motion Out curve. The animation is a weight, 0
// (no visible effect) to 1 (the effect as set), that each effect maps onto
// its parameters. By default every knob with a neutral value in
// `fx-animation-defaults.ts` runs from that neutral value to its set value.
//
// The weight is always the clip's being drawn: a clip effect follows its own
// clip, and a layer or Global effect follows each clip it is drawn on, so
// every clip animates on its own. Whole-frame Global work (the Global chain,
// Zoom & Pan among it, and the Global Order) follows the topmost active
// clip. It depends only on the timeline position, so preview and export
// match frame for frame.

import {
  BLACK_BORDER,
  ORDER_EFFECT_NAME,
  type OrderSlide,
} from "./composition-order.ts";
import { formatCssColor, parseCssColor, type Rgba } from "./fill-paint.ts";
import type {
  AnimatableEffect,
  AnimatedParameter,
  AnimationClipContext,
  AnimationFrameContext,
} from "./fx-animation.ts";
import {
  type ClipAnimation,
  type ClipMotion,
  type EffectAnimation,
  FULL_CLIP_TIMING,
  getAnimationNeutralValues,
  getClipTimingFrames,
} from "./fx-animation-defaults.ts";
import { getEffectDefinition } from "./fx-registry.ts";
import { easeMotion } from "./motion-easing.ts";
import { TEXT_EFFECT_NAME } from "./text-style.ts";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

// One side's eased progress: 1 once it is done, and always with None.
function easeSide(motion: ClipMotion, progress: number) {
  return motion === "None" ? 1 : easeMotion(motion, progress);
}

// How far the effect is animated in, 0..1, `elapsedSeconds` into a clip of
// `durationSeconds`, when each side takes `frames` frames at `fps`. A clip
// shorter than both sides shortens them to half its length each, so they
// never overlap.
export function clipAnimationWeight(
  animation: Pick<ClipAnimation, "motionIn" | "motionOut">,
  frames: number,
  fps: number,
  elapsedSeconds: number,
  durationSeconds: number,
) {
  const sideSeconds = Math.min(
    fps > 0 ? Math.max(0, frames) / fps : 0,
    Math.max(0, durationSeconds) / 2,
  );
  if (!(sideSeconds > 0)) {
    return 1;
  }

  const enter = clamp(elapsedSeconds / sideSeconds, 0, 1);
  const exit = clamp((durationSeconds - elapsedSeconds) / sideSeconds, 0, 1);
  return Math.min(
    easeSide(animation.motionIn, enter),
    easeSide(animation.motionOut, exit),
  );
}

function readNumber(parameter: AnimatedParameter | undefined) {
  const value =
    parameter?.numericValue ??
    (parameter ? Number.parseFloat(parameter.value) : Number.NaN);
  return Number.isFinite(value) ? value : undefined;
}

function registryDefault(effectName: string, key: string) {
  const definition = getEffectDefinition(effectName).parameters.find(
    (parameter) => parameter.key === key,
  );
  return definition?.kind === "number" ? definition.defaultValue : undefined;
}

function numberParameter(key: string, value: number): AnimatedParameter {
  return { key, value: value.toFixed(3), numericValue: value };
}

// The generic mapping: each knob with a neutral value runs from it to the
// knob's set value. Knobs the effect doesn't store animate towards their
// default.
function interpolateFromNeutral(
  effectName: string,
  parameters: AnimatedParameter[],
  weight: number,
) {
  const neutrals = getAnimationNeutralValues(effectName);
  const at = (key: string, target: number) => {
    const { neutral } = neutrals[key];
    return numberParameter(key, neutral + (target - neutral) * weight);
  };
  const result = parameters.map((parameter) => {
    const target = readNumber(parameter);
    return Object.hasOwn(neutrals, parameter.key) && target !== undefined
      ? at(parameter.key, target)
      : parameter;
  });
  for (const key of Object.keys(neutrals)) {
    const target = registryDefault(effectName, key);
    if (
      target !== undefined &&
      !parameters.some((parameter) => parameter.key === key)
    ) {
      result.push(at(key, target));
    }
  }
  return result;
}

const CSS_COLOR_PATTERN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;

// `value` with the alpha of every CSS colour in it scaled by `weight`, which
// covers plain colours and each stop of a gradient.
export function fadeCssColors(value: string, weight: number) {
  return value.replace(CSS_COLOR_PATTERN, (match) => {
    const color = parseCssColor(match);
    return color ? formatCssColor({ ...color, a: color.a * weight }) : match;
  });
}

const TEXT_COLOR_KEYS = new Set(["Color", "Gradient", "Stroke", "ShadowColor"]);

// `value`, a CSS colour, blended from `from` by `weight`, linearly in RGBA.
function blendCssColor(value: string, from: Rgba, weight: number) {
  const color = parseCssColor(value);
  if (!color) {
    return value;
  }
  const at = (start: number, end: number) => start + (end - start) * weight;
  return formatCssColor({
    r: at(from.r, color.r),
    g: at(from.g, color.g),
    b: at(from.b, color.b),
    a: at(from.a, color.a),
  });
}

// Per-effect mappings, where fading the knobs isn't what "no effect" means.
const CLIP_ANIMATIONS: ReadonlyMap<
  string,
  (parameters: AnimatedParameter[], weight: number) => AnimatedParameter[]
> = new Map([
  // Order's spacing grows from none, and its border colour tweens from the
  // default black. Its slots slide on their own (`resolveOrderSlide`).
  [
    ORDER_EFFECT_NAME,
    (parameters, weight) =>
      interpolateFromNeutral(ORDER_EFFECT_NAME, parameters, weight).map(
        (parameter) =>
          parameter.key === "BorderColor"
            ? {
                ...parameter,
                value: blendCssColor(parameter.value, BLACK_BORDER, weight),
              }
            : parameter,
      ),
  ],
  // Text has no opacity: it fades in and out through its colours' alpha.
  [
    TEXT_EFFECT_NAME,
    (parameters, weight) =>
      parameters.map((parameter) =>
        TEXT_COLOR_KEYS.has(parameter.key)
          ? { ...parameter, value: fadeCssColors(parameter.value, weight) }
          : parameter,
      ),
  ],
]);

// `effect`'s parameters at `weight`: as set at 1, and with no visible effect
// at 0. Returns `effect.parameters` itself at 1.
export function applyClipAnimationWeight(
  effect: Pick<AnimatableEffect, "effectName" | "parameters">,
  weight: number,
) {
  if (weight >= 1) {
    return effect.parameters;
  }

  const animate = CLIP_ANIMATIONS.get(effect.effectName);
  return animate
    ? animate(effect.parameters, weight)
    : interpolateFromNeutral(effect.effectName, effect.parameters, weight);
}

// The parameters a Clip-mode effect is drawn with for the clip and frame.
export function resolveClipAnimatedParameters(
  effect: AnimatableEffect,
  clipContext: AnimationClipContext,
  frameContext: AnimationFrameContext,
) {
  const clip = effect.animation?.clip;
  const frames = clip && getClipTimingFrames(effect.effectName, clip.timing);
  if (!clip || frames === undefined) {
    return effect.parameters;
  }

  const weight = clipAnimationWeight(
    clip,
    frames,
    frameContext.fps,
    clipContext.elapsedSeconds,
    clipContext.durationSeconds,
  );
  // With Full timing an Order stays on screen for its whole clip, so its
  // border keeps its colour and only the spacing tweens.
  if (
    clip.timing === FULL_CLIP_TIMING &&
    effect.effectName === ORDER_EFFECT_NAME
  ) {
    return weight >= 1
      ? effect.parameters
      : interpolateFromNeutral(effect.effectName, effect.parameters, weight);
  }
  return applyClipAnimationWeight(effect, weight);
}

// The slide an Order with this animation gives its layers, at `fps`, or
// undefined when it isn't animating in Clip mode.
export function resolveOrderSlide(
  animation: EffectAnimation | undefined,
  fps: number,
): OrderSlide | undefined {
  // With Full timing the spacing tweens across the whole clip, but the
  // layers snap into their slots: sliding for half of every clip would hide
  // the cuts beneath the Order.
  if (
    !animation?.enabled ||
    animation.mode !== "clip" ||
    animation.clip.timing === FULL_CLIP_TIMING
  ) {
    return undefined;
  }
  const frames = getClipTimingFrames(ORDER_EFFECT_NAME, animation.clip.timing);
  return frames === undefined
    ? undefined
    : {
        motionIn: animation.clip.motionIn,
        motionOut: animation.clip.motionOut,
        frames,
        fps,
      };
}

// How far a clip `elapsedSeconds` into its `durationSeconds` has slid into
// its slot: 0 outside it, 1 in place.
export function orderSlideWeight(
  slide: OrderSlide,
  elapsedSeconds: number,
  durationSeconds: number,
) {
  return clipAnimationWeight(
    slide,
    slide.frames,
    slide.fps,
    elapsedSeconds,
    durationSeconds,
  );
}
