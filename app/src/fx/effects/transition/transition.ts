// The Transition effect: on an FX clip, it blends from comp A, everything
// beneath the clip at its start, to comp B, everything beneath it at its
// end, each drawn whole. Layers an Order arranges count as one comp. Its
// Animation's Timing sets how long the blend takes, centered in the clip
// (Full spans it), and Motion In and Motion Out ease its first half (A
// going out) and second half (B coming in).

import { easeMotion } from "../move/motion-easing.ts";
import { findTransitionType } from "./registry.ts";
import type { Vec2 } from "./type.ts";

export const TRANSITION_EFFECT_NAME = "Transition";
export const TYPE_KEY = "Type";
export const DIRECTION_KEY = "Direction";
export const SOFTNESS_KEY = "Softness";

export const TRANSITION_DIRECTIONS = ["Left", "Right", "Up", "Down"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];
export const DEFAULT_DIRECTION: TransitionDirection = "Left";
export const DEFAULT_SOFTNESS = 0.2;

// Frames the blend takes at the Slow, Normal and Fast Timings.
export const TRANSITION_FRAMES = [30, 20, 10] as const;

// The way things move for each Direction, in picture coordinates (+y up).
const DIRECTION_VECTORS: Record<TransitionDirection, Vec2> = {
  Left: [-1, 0],
  Right: [1, 0],
  Up: [0, 1],
  Down: [0, -1],
};

export function isTransitionEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "transition";
}

// What eases each half of the blend, as the Animation's Clip motions: None
// jumps straight to the end of its half.
export type TransitionMotion =
  | "None"
  | "Linear"
  | "Ease In"
  | "Ease Out"
  | "Ease In Out";

function easeHalf(motion: TransitionMotion, progress: number) {
  if (motion === "None") {
    return progress > 0 ? 1 : 0;
  }
  return easeMotion(motion, progress);
}

// How far from comp A (0) to comp B (1) the blend is `elapsedSeconds` into
// an FX clip `durationSeconds` long, when it takes `seconds` centered in
// the clip; longer than the clip, as Full is, it spans the clip.
// `motionIn` eases its first half and `motionOut` its second.
export function transitionProgress(
  motion: { motionIn: TransitionMotion; motionOut: TransitionMotion },
  seconds: number,
  elapsedSeconds: number,
  durationSeconds: number,
) {
  const duration = Math.max(0, durationSeconds);
  const length = Math.min(Math.max(0, seconds), duration);
  const start = (duration - length) / 2;
  const linear =
    length > 0
      ? Math.max(0, Math.min(1, (elapsedSeconds - start) / length))
      : elapsedSeconds >= duration / 2
        ? 1
        : 0;
  return linear < 0.5
    ? easeHalf(motion.motionIn, linear * 2) / 2
    : 0.5 + easeHalf(motion.motionOut, linear * 2 - 1) / 2;
}

export function parseTransitionDirection(
  value: string | undefined,
): TransitionDirection {
  const wanted = value?.trim().toLowerCase();
  return (
    TRANSITION_DIRECTIONS.find(
      (direction) => direction.toLowerCase() === wanted,
    ) ?? DEFAULT_DIRECTION
  );
}

export function directionVector(direction: TransitionDirection): Vec2 {
  return DIRECTION_VECTORS[direction];
}

type TransitionParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

// What a Transition draws with at a frame: its type's name, Direction as a
// vector, Softness, and how far it is from comp A to comp B.
export type TransitionSettings = {
  type: string;
  direction: Vec2;
  softness: number;
  progress: number;
};

export function parseTransitionSettings(
  parameters: readonly TransitionParameter[],
  progress: number,
): TransitionSettings {
  const read = (key: string) =>
    parameters.find((parameter) => parameter.key === key);
  const softness = read(SOFTNESS_KEY);
  const softnessValue =
    softness?.numericValue ?? Number.parseFloat(softness?.value ?? "");
  return {
    type: findTransitionType(read(TYPE_KEY)?.value).name,
    direction: directionVector(
      parseTransitionDirection(read(DIRECTION_KEY)?.value),
    ),
    softness: Number.isFinite(softnessValue)
      ? Math.max(0, Math.min(1, softnessValue))
      : DEFAULT_SOFTNESS,
    progress: Math.max(0, Math.min(1, progress)),
  };
}

// The last enabled Transition on the `trackId` stack.
export function findTransitionEffect<
  T extends { trackId: string; effectName: string; enabled?: boolean },
>(effects: readonly T[], trackId: string): T | undefined {
  return effects.findLast(
    (effect) =>
      effect.trackId === trackId &&
      effect.enabled !== false &&
      isTransitionEffectName(effect.effectName),
  );
}
