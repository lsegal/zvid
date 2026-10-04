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
//
// An Order doesn't animate itself: its Clip mode moves the clips beneath it
// as they enter and leave while it is active (`resolveOrderSlide`).

import { ORDER_EFFECT_NAME, type OrderSlide } from "./composition-order.ts";
import { formatCssColor, parseCssColor } from "./fill-paint.ts";
import { TRANSITION_EFFECT_NAME } from "./fx/effects/transition/transition.ts";
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

// Whether a clip starts on the session's first frame and ends on or past its
// last. Those ends don't animate: the video neither opens with a tween from
// nothing nor ends with a tween to nothing.
export type SessionEdges = { atStart: boolean; atEnd: boolean };

// The session edges of a clip starting `startSeconds` in and lasting
// `durationSeconds`, in a session `sessionEndSeconds` long, compared in
// whole frames at `fps` so a clip a sub-frame off still counts. The edges
// are the session's, not an export's In/Out range, so a render is the same
// whatever range is exported.
export function clipSessionEdges(
  startSeconds: number,
  durationSeconds: number,
  sessionEndSeconds: number,
  fps: number,
): SessionEdges {
  const frame = (seconds: number) => Math.round(seconds * Math.max(1, fps));
  return {
    atStart: frame(startSeconds) <= 0,
    atEnd: frame(startSeconds + durationSeconds) >= frame(sessionEndSeconds),
  };
}

// How far the effect is animated in, 0..1, `elapsedSeconds` into a clip of
// `durationSeconds`, when each side takes `frames` frames at `fps`. A clip
// shorter than both sides shortens them to half its length each, so they
// never overlap. A side on one of the session's `edges` doesn't animate.
export function clipAnimationWeight(
  animation: Pick<ClipAnimation, "motionIn" | "motionOut">,
  frames: number,
  fps: number,
  elapsedSeconds: number,
  durationSeconds: number,
  edges?: SessionEdges,
) {
  const sideSeconds = Math.min(
    fps > 0 ? Math.max(0, frames) / fps : 0,
    Math.max(0, durationSeconds) / 2,
  );
  if (!(sideSeconds > 0)) {
    return 1;
  }

  const enter = edges?.atStart ? 1 : clamp(elapsedSeconds / sideSeconds, 0, 1);
  const exit = edges?.atEnd
    ? 1
    : clamp((durationSeconds - elapsedSeconds) / sideSeconds, 0, 1);
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

// `value` with the alpha of every CSS color in it scaled by `weight`, which
// covers plain colors and each stop of a gradient.
export function fadeCssColors(value: string, weight: number) {
  return value.replace(CSS_COLOR_PATTERN, (match) => {
    const color = parseCssColor(match);
    return color ? formatCssColor({ ...color, a: color.a * weight }) : match;
  });
}

const TEXT_COLOR_KEYS = new Set(["Color", "Gradient", "Stroke", "ShadowColor"]);

// Per-effect mappings, where fading the knobs isn't what "no effect" means.
const CLIP_ANIMATIONS: ReadonlyMap<
  string,
  (parameters: AnimatedParameter[], weight: number) => AnimatedParameter[]
> = new Map([
  // Text has no opacity: it fades in and out through its colors' alpha.
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
  // An Order's knobs never tween: its Clip mode moves the clips beneath it.
  // A Transition's Clip mode times its blend (see composition-transition.ts).
  if (
    !clip ||
    frames === undefined ||
    effect.effectName === ORDER_EFFECT_NAME ||
    effect.effectName === TRANSITION_EFFECT_NAME
  ) {
    return effect.parameters;
  }

  const weight = clipAnimationWeight(
    clip,
    frames,
    frameContext.fps,
    clipContext.elapsedSeconds,
    clipContext.durationSeconds,
    clipContext.sessionEdges,
  );
  return applyClipAnimationWeight(effect, weight);
}

// How a clip eases into and out of an Order's arrangement: the same both
// ways, so leaving is entering played backwards.
export const ORDER_SLIDE_MOTION = {
  motionIn: "Ease In Out",
  motionOut: "Ease In Out",
} as const satisfies Pick<ClipAnimation, "motionIn" | "motionOut">;

// The slide an Order with this animation gives its layers, at `fps`, or
// undefined when it isn't animating in Clip mode. `window` is the Order
// clip's, for an FX clip's Order.
export function resolveOrderSlide(
  animation: EffectAnimation | undefined,
  fps: number,
  window?: OrderSlide["window"],
): OrderSlide | undefined {
  if (!animation?.enabled || animation.mode !== "clip") {
    return undefined;
  }
  const frames = getClipTimingFrames(ORDER_EFFECT_NAME, animation.clip.timing);
  return frames === undefined || !Number.isFinite(frames)
    ? undefined
    : {
        frames,
        fps,
        ...(animation.clip.transition
          ? { transition: animation.clip.transition }
          : {}),
        ...(window ? { window } : {}),
      };
}

// How far a clip `elapsedSeconds` into its `durationSeconds` has slid into
// its slot: 0 outside it, 1 in place. It doesn't slide on its session
// `edges`, nor at an end the Order's `window` doesn't reach: a clip that
// was there before the Order started, or stays after it ends.
export function orderSlideWeight(
  slide: OrderSlide,
  elapsedSeconds: number,
  durationSeconds: number,
  edges?: SessionEdges,
) {
  const frame = (seconds: number) =>
    Math.round(seconds * Math.max(1, slide.fps));
  const window = slide.window;
  return clipAnimationWeight(
    ORDER_SLIDE_MOTION,
    slide.frames,
    slide.fps,
    elapsedSeconds,
    durationSeconds,
    {
      atStart:
        Boolean(edges?.atStart) ||
        (window !== undefined &&
          frame(elapsedSeconds) >= frame(window.elapsedSeconds)),
      atEnd:
        Boolean(edges?.atEnd) ||
        (window !== undefined &&
          frame(durationSeconds - elapsedSeconds) >=
            frame(window.remainingSeconds)),
    },
  );
}
