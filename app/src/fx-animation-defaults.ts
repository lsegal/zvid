// The Animation modifier an effect can carry: its settings, and each
// effect's defaults for them. Effects that aren't listed here, Layout among
// them, don't support animation. Kept apart from the registry so the
// animation work doesn't collide with registry edits.

import { ORDER_EFFECT_NAME } from "./composition-order.ts";
import { MOVE_EFFECT_NAME } from "./composition-transform.ts";
import { COLOR_EFFECT_NAME } from "./fill-paint.ts";
import { getEffectDefinition } from "./fx-registry.ts";
import { TEXT_EFFECT_NAME } from "./text-style.ts";

export const ANIMATION_MODES = ["clip", "reactive"] as const;
export type AnimationMode = (typeof ANIMATION_MODES)[number];

export const CLIP_MOTIONS = [
  "None",
  "Linear",
  "Ease In",
  "Ease Out",
  "Ease In Out",
] as const;
export type ClipMotion = (typeof CLIP_MOTIONS)[number];

export const REACTIVE_MOTIONS = ["None", "Bounce", "Wobble"] as const;
export type ReactiveMotion = (typeof REACTIVE_MOTIONS)[number];

export const ANIMATION_TIMINGS = ["Slow", "Normal", "Fast"] as const;
export type AnimationTiming = (typeof ANIMATION_TIMINGS)[number];

export type ClipAnimation = {
  motionIn: ClipMotion;
  motionOut: ClipMotion;
  timing: AnimationTiming;
};

export type ReactiveAnimation = {
  motion: ReactiveMotion;
  timing: AnimationTiming;
  // How strongly the music moves the parameters, 0..1.
  reactivity: number;
  // Keys of the knob parameters the music moves.
  parameters: string[];
};

// Stored on an effect instance, and saved to `.lvp` as zvid-only
// `animation`. Turning the modifier off keeps the settings for next time.
// Effects that only support Clip mode have no `reactive` settings.
export type EffectAnimation = {
  enabled: boolean;
  mode: AnimationMode;
  clip: ClipAnimation;
  reactive?: ReactiveAnimation;
};

// Frames an animation takes at each timing.
export type AnimationTimingFrames = Readonly<Record<AnimationTiming, number>>;

export type FxAnimationDefaults = {
  // The modes the effect's Animation offers, Clip first.
  modes: readonly AnimationMode[];
  clip: Readonly<ClipAnimation>;
  clipFrames: AnimationTimingFrames;
  // Absent when the effect doesn't support Reactive mode.
  reactive?: Readonly<ReactiveAnimation>;
  reactiveFrames: AnimationTimingFrames;
};

export const DEFAULT_REACTIVE_FRAMES: AnimationTimingFrames = {
  Slow: 18,
  Normal: 12,
  Fast: 6,
};

export const REACTIVITY_STEP = 0.1;

// Defaults for an effect that only animates on its clip's enter and exit.
function clipDefaults(
  motionIn: ClipMotion,
  motionOut: ClipMotion,
  [slow, normal, fast]: readonly [number, number, number],
): FxAnimationDefaults {
  return {
    modes: ["clip"],
    clip: { motionIn, motionOut, timing: "Normal" },
    clipFrames: { Slow: slow, Normal: normal, Fast: fast },
    reactiveFrames: DEFAULT_REACTIVE_FRAMES,
  };
}

function defaults(
  motionIn: ClipMotion,
  motionOut: ClipMotion,
  frames: readonly [number, number, number],
  motion: ReactiveMotion,
  reactivity: number,
  parameters: readonly string[],
): FxAnimationDefaults {
  return {
    ...clipDefaults(motionIn, motionOut, frames),
    modes: ANIMATION_MODES,
    reactive: {
      motion,
      timing: "Normal",
      reactivity,
      parameters: [...parameters],
    },
  };
}

const ANIMATION_DEFAULTS: ReadonlyMap<string, FxAnimationDefaults> = new Map([
  // Order arranges layers; jiggling its arrangement on audio hits isn't a
  // meaningful effect, so it only animates in Clip mode.
  [ORDER_EFFECT_NAME, clipDefaults("Ease Out", "Ease In", [7, 5, 3])],
  [
    "Transform",
    defaults("Ease Out", "Ease In", [12, 8, 4], "Bounce", 0.3, [
      "ScaleX",
      "ScaleY",
    ]),
  ],
  [
    MOVE_EFFECT_NAME,
    defaults("Linear", "Linear", [12, 8, 4], "Wobble", 0.2, [
      "StartRotation",
      "EndRotation",
    ]),
  ],
  [
    "ZoomAndPan",
    defaults("Ease In Out", "Ease In Out", [16, 10, 6], "Bounce", 0.3, [
      "_End_Zoom",
    ]),
  ],
  [
    "Colorize",
    defaults("Ease Out", "Ease In", [12, 8, 4], "Wobble", 0.5, ["_HueOffset"]),
  ],
  [
    "Pixelate",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Bounce", 0.5, ["_NumPixels"]),
  ],
  [
    "NegativeSplit",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Wobble", 0.5, [
      "_LowIntensity",
      "_HighIntensity",
    ]),
  ],
  [
    "AnalogGlitch",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Wobble", 0.6, [
      "_LowMod",
      "_HighMod",
    ]),
  ],
  [
    COLOR_EFFECT_NAME,
    defaults("Ease Out", "Ease In", [12, 8, 4], "Bounce", 0.3, ["Opacity"]),
  ],
  [
    TEXT_EFFECT_NAME,
    defaults("Ease Out", "Ease In", [12, 8, 4], "Bounce", 0.3, [
      "FontSize",
      "LetterSpacing",
    ]),
  ],
]);

// The effect's animation defaults, or undefined when it doesn't support
// animation.
export function getAnimationDefaults(effectName: string) {
  return ANIMATION_DEFAULTS.get(effectName);
}

export function supportsAnimation(effectName: string) {
  return ANIMATION_DEFAULTS.has(effectName);
}

// The modes the effect's Animation offers; none when it doesn't support
// animation.
export function getAnimationModes(
  effectName: string,
): readonly AnimationMode[] {
  return getAnimationDefaults(effectName)?.modes ?? [];
}

export function supportsAnimationMode(effectName: string, mode: AnimationMode) {
  return getAnimationModes(effectName).includes(mode);
}

export type AnimatableParameter = { key: string; label: string };

// The parameters Reactive mode can modulate: the effect's visible knobs.
export function getAnimatableParameters(
  effectName: string,
): AnimatableParameter[] {
  return getEffectDefinition(effectName)
    .parameters.filter(
      (parameter) => parameter.kind === "number" && !parameter.hidden,
    )
    .map((parameter) => ({ key: parameter.key, label: parameter.label }));
}

// The settings an effect's animation starts from when first turned on, or
// undefined when the effect doesn't support animation.
export function createDefaultAnimation(
  effectName: string,
): EffectAnimation | undefined {
  const effectDefaults = getAnimationDefaults(effectName);
  if (!effectDefaults) {
    return undefined;
  }

  const reactive = effectDefaults.reactive;
  return {
    enabled: true,
    mode: "clip",
    clip: { ...effectDefaults.clip },
    ...(reactive
      ? { reactive: { ...reactive, parameters: [...reactive.parameters] } }
      : {}),
  };
}

export function getClipTimingFrames(
  effectName: string,
  timing: AnimationTiming,
) {
  return getAnimationDefaults(effectName)?.clipFrames[timing];
}

export function getReactiveTimingFrames(
  effectName: string,
  timing: AnimationTiming,
) {
  return (getAnimationDefaults(effectName)?.reactiveFrames ??
    DEFAULT_REACTIVE_FRAMES)[timing];
}

function readOption<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === "string"
    ? (options.find(
        (option) => option.toLowerCase() === value.trim().toLowerCase(),
      ) ?? fallback)
    : fallback;
}

function readReactivity(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The animation an effect was saved or synced with, with anything missing or
// malformed filled in from the effect's defaults. Undefined when there is
// none, or the effect doesn't support animation. A mode the effect doesn't
// support, such as Reactive on an Order, loads as Clip, and its settings are
// dropped.
export function normalizeEffectAnimation(
  raw: unknown,
  effectName: string,
): EffectAnimation | undefined {
  const fallback = createDefaultAnimation(effectName);
  if (!fallback || !isRecord(raw)) {
    return undefined;
  }

  const clip = isRecord(raw.clip) ? raw.clip : {};
  return {
    enabled: raw.enabled === true,
    mode: readOption(raw.mode, getAnimationModes(effectName), fallback.mode),
    clip: {
      motionIn: readOption(clip.motionIn, CLIP_MOTIONS, fallback.clip.motionIn),
      motionOut: readOption(
        clip.motionOut,
        CLIP_MOTIONS,
        fallback.clip.motionOut,
      ),
      timing: readOption(clip.timing, ANIMATION_TIMINGS, fallback.clip.timing),
    },
    ...(fallback.reactive
      ? { reactive: normalizeReactive(raw.reactive, fallback.reactive) }
      : {}),
  };
}

function normalizeReactive(
  raw: unknown,
  fallback: ReactiveAnimation,
): ReactiveAnimation {
  const reactive = isRecord(raw) ? raw : {};
  return {
    motion: readOption(reactive.motion, REACTIVE_MOTIONS, fallback.motion),
    timing: readOption(reactive.timing, ANIMATION_TIMINGS, fallback.timing),
    reactivity: readReactivity(reactive.reactivity, fallback.reactivity),
    parameters: Array.isArray(reactive.parameters)
      ? [
          ...new Set(
            reactive.parameters.filter(
              (key): key is string => typeof key === "string",
            ),
          ),
        ]
      : fallback.parameters,
  };
}

// The Parameters button's label: how many of the effect's knobs Reactive
// mode modulates.
export function describeAnimatedParameters(
  selected: readonly string[],
  available: readonly AnimatableParameter[],
) {
  const chosen = available.filter((parameter) =>
    selected.includes(parameter.key),
  ).length;
  return `Parameters: ${chosen} of ${available.length}`;
}

// `parameters` with `key` added, or removed when it is already there, in the
// order the effect lists its knobs.
export function toggleAnimatedParameter(
  parameters: readonly string[],
  key: string,
  available: readonly AnimatableParameter[],
) {
  const next = new Set(parameters);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  const order = available.map((parameter) => parameter.key);
  return [...next].sort((left, right) => {
    const a = order.indexOf(left);
    const b = order.indexOf(right);
    return (a < 0 ? order.length : a) - (b < 0 ? order.length : b);
  });
}

// Where Clip mode animates a knob from: the value at which it has no visible
// effect. The effect fades in from it on a clip's enter and back to it on
// its exit.
export type AnimationNeutralValue = { neutral: number };

const TRANSFORM_NEUTRALS = {
  PositionX: { neutral: 0 },
  PositionY: { neutral: 0 },
  ScaleX: { neutral: 1 },
  ScaleY: { neutral: 1 },
  Rotation: { neutral: 0 },
} satisfies Record<string, AnimationNeutralValue>;

function prefixed(
  prefix: string,
  neutrals: Record<string, AnimationNeutralValue>,
) {
  return Object.fromEntries(
    Object.entries(neutrals).map(([key, value]) => [`${prefix}${key}`, value]),
  );
}

type AnimationNeutralValues = Readonly<Record<string, AnimationNeutralValue>>;

const NEUTRAL_VALUES: ReadonlyMap<string, AnimationNeutralValues> = new Map<
  string,
  AnimationNeutralValues
>([
  // Order's own slide is separate; this tweens the spacing, and its border
  // with it.
  [ORDER_EFFECT_NAME, { Spacing: { neutral: 0 } }],
  ["Transform", TRANSFORM_NEUTRALS],
  [
    MOVE_EFFECT_NAME,
    {
      ...prefixed("Start", TRANSFORM_NEUTRALS),
      ...prefixed("End", TRANSFORM_NEUTRALS),
    },
  ],
  // A zoom of 0 is 1.00×, centered.
  [
    "ZoomAndPan",
    {
      _Start_Zoom: { neutral: 0 },
      _Start_X: { neutral: 0.5 },
      _Start_Y: { neutral: 0.5 },
      _End_Zoom: { neutral: 0 },
      _End_X: { neutral: 0.5 },
      _End_Y: { neutral: 0.5 },
    },
  ],
  ["Colorize", { _HueOffset: { neutral: 0 } }],
  [
    "Pixelate",
    {
      _NumPixels: { neutral: 0 },
      _LowIntensity: { neutral: 0 },
      _HighIntensity: { neutral: 0 },
    },
  ],
  [
    "NegativeSplit",
    { _LowIntensity: { neutral: 0 }, _HighIntensity: { neutral: 0 } },
  ],
  ["AnalogGlitch", { _LowMod: { neutral: 0 }, _HighMod: { neutral: 0 } }],
  [COLOR_EFFECT_NAME, { Opacity: { neutral: 0 } }],
  // Text has no opacity knob: Clip mode fades its colors instead.
  [TEXT_EFFECT_NAME, {}],
]);

// The knobs Clip mode animates for the effect, keyed by parameter, and each
// one's neutral value.
export function getAnimationNeutralValues(
  effectName: string,
): AnimationNeutralValues {
  return NEUTRAL_VALUES.get(effectName) ?? {};
}
