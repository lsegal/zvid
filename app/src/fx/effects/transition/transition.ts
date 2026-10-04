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
export const IRIS_KEY = "Iris";
export const ORIENTATION_KEY = "Orientation";
export const COUNT_KEY = "Count";
export const ORIGIN_KEY = "Origin";

export const TRANSITION_DIRECTIONS = ["Left", "Right", "Up", "Down"] as const;
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];
export const DEFAULT_DIRECTION: TransitionDirection = "Left";
export const DEFAULT_SOFTNESS = 0.2;

// Frames the blend takes at the Slow, Normal and Fast Timings.
export const TRANSITION_FRAMES = [30, 20, 10] as const;

// Out opens an iris out of the center onto B; In closes A into it.
export const TRANSITION_IRISES = ["Out", "In"] as const;
export type TransitionIris = (typeof TRANSITION_IRISES)[number];
export const DEFAULT_IRIS: TransitionIris = "Out";

export const TRANSITION_ORIENTATIONS = ["Horizontal", "Vertical"] as const;
export type TransitionOrientation = (typeof TRANSITION_ORIENTATIONS)[number];
export const DEFAULT_ORIENTATION: TransitionOrientation = "Horizontal";

export const MIN_COUNT = 2;
export const MAX_COUNT = 32;
export const DEFAULT_COUNT = 8;

export const TRANSITION_ORIGINS = [
  "Center",
  "Top Left",
  "Top Right",
  "Bottom Left",
  "Bottom Right",
] as const;
export type TransitionOrigin = (typeof TRANSITION_ORIGINS)[number];
export const DEFAULT_ORIGIN: TransitionOrigin = "Center";

// Where each Origin is, in picture coordinates (+y up).
const ORIGIN_POINTS: Record<TransitionOrigin, Vec2> = {
  Center: [0.5, 0.5],
  "Top Left": [0, 1],
  "Top Right": [1, 1],
  "Bottom Left": [0, 0],
  "Bottom Right": [1, 0],
};

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

// The option in `options` named `value`, case-insensitively, or `fallback`.
function parseOption<T extends string>(
  options: readonly T[],
  value: string | undefined,
  fallback: T,
): T {
  const wanted = value?.trim().toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted) ?? fallback;
}

export function originPoint(origin: TransitionOrigin): Vec2 {
  return ORIGIN_POINTS[origin];
}

type TransitionParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

// What a Transition draws with at a frame: its type's name, Direction as a
// vector, Softness, whether an iris closes In, whether bands are Vertical,
// their Count, the Origin as a point, and how far it is from comp A to
// comp B.
export type TransitionSettings = {
  type: string;
  direction: Vec2;
  softness: number;
  irisIn: boolean;
  vertical: boolean;
  count: number;
  origin: Vec2;
  progress: number;
};

function readNumber(parameter: TransitionParameter | undefined) {
  const value =
    parameter?.numericValue ?? Number.parseFloat(parameter?.value ?? "");
  return Number.isFinite(value) ? value : undefined;
}

export function parseTransitionSettings(
  parameters: readonly TransitionParameter[],
  progress: number,
): TransitionSettings {
  const read = (key: string) =>
    parameters.find((parameter) => parameter.key === key);
  const softness = readNumber(read(SOFTNESS_KEY));
  const count = readNumber(read(COUNT_KEY));
  return {
    type: findTransitionType(read(TYPE_KEY)?.value).name,
    direction: directionVector(
      parseTransitionDirection(read(DIRECTION_KEY)?.value),
    ),
    softness:
      softness === undefined
        ? DEFAULT_SOFTNESS
        : Math.max(0, Math.min(1, softness)),
    irisIn:
      parseOption(TRANSITION_IRISES, read(IRIS_KEY)?.value, DEFAULT_IRIS) ===
      "In",
    vertical:
      parseOption(
        TRANSITION_ORIENTATIONS,
        read(ORIENTATION_KEY)?.value,
        DEFAULT_ORIENTATION,
      ) === "Vertical",
    count:
      count === undefined
        ? DEFAULT_COUNT
        : Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(count))),
    origin: originPoint(
      parseOption(TRANSITION_ORIGINS, read(ORIGIN_KEY)?.value, DEFAULT_ORIGIN),
    ),
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
