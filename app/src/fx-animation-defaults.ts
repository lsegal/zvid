// The Animation modifier an effect can carry: its settings, and each
// effect's defaults for them. Effects that aren't listed here, Layout and
// Mask among them, don't support animation. Kept apart from the
// registry so the animation work doesn't collide with registry edits.

import { ORDER_EFFECT_NAME } from "./composition-order.ts";
import { MOVE_EFFECT_NAME } from "./composition-transform.ts";
import { COLOR_EFFECT_NAME } from "./fill-paint.ts";
import { LEVELS_EFFECT_NAME } from "./fx/effects/levels/levels.ts";
import { OPACITY_EFFECT_NAME } from "./fx/effects/opacity/opacity.ts";
import { OFFSET_KEY, SHAPE_EFFECT_NAME } from "./fx/effects/shape/shape.ts";
import {
  TRANSITION_EFFECT_NAME,
  TRANSITION_FRAMES,
} from "./fx/effects/transition/transition.ts";
import { getEffectDefinition } from "./fx-registry.ts";
import { TEXT_EFFECT_NAME } from "./text-style.ts";

export const ANIMATION_MODES = ["clip", "reactive", "lfo"] as const;
export type AnimationMode = (typeof ANIMATION_MODES)[number];

export const CLIP_MOTIONS = [
  "None",
  "Linear",
  "Ease In",
  "Ease Out",
  "Ease In Out",
] as const;
export type ClipMotion = (typeof CLIP_MOTIONS)[number];

export const REACTIVE_MOTIONS = ["None", "Bounce", "Wobble", "Single"] as const;
export type ReactiveMotion = (typeof REACTIVE_MOTIONS)[number];

export const LFO_SHAPES = [
  "Sine",
  "Triangle",
  "Saw Up",
  "Saw Down",
  "Square",
  "Random",
] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];

// Tempo-synced LFO rates: the length of one cycle as a note value. A dotted
// value is half as long again; a triplet is two thirds as long.
export const LFO_SYNC_RATES = [
  "4 Bars",
  "2 Bars",
  "1 Bar",
  "1/2",
  "1/2D",
  "1/2T",
  "1/4",
  "1/4D",
  "1/4T",
  "1/8",
  "1/8D",
  "1/8T",
  "1/16",
  "1/16D",
  "1/16T",
  "1/32",
] as const;
export type LfoSyncRate = (typeof LFO_SYNC_RATES)[number];

// The free-running Rate's range, in Hz.
export const LFO_MIN_RATE = 0.05;
export const LFO_MAX_RATE = 20;
export const LFO_MAX_PHASE = 360;

export const ANIMATION_TIMINGS = ["Slow", "Normal", "Fast"] as const;
export type AnimationTiming = (typeof ANIMATION_TIMINGS)[number];

// Clip mode's timings add Full, where each side takes half the clip: the
// effect eases in until the middle of the clip and back out by its end.
export const FULL_CLIP_TIMING = "Full";
export const CLIP_TIMINGS = [...ANIMATION_TIMINGS, FULL_CLIP_TIMING] as const;
export type ClipTiming = (typeof CLIP_TIMINGS)[number];

// How an Order's clips enter and exit its arrangement, from the side their
// slot is on: Push slides them in from that canvas edge, or fades them in
// between others; Squish grows them from zero width or height.
export const ORDER_TRANSITIONS = ["Push", "Squish"] as const;
export type OrderTransition = (typeof ORDER_TRANSITIONS)[number];

// Order sessions saved before Transition existed keep sliding.
const LEGACY_ORDER_TRANSITION: OrderTransition = "Push";

// How Order sessions saved before their slides followed Motion In and Out
// eased them: the same both ways, so leaving was entering played backwards.
const LEGACY_ORDER_SLIDE_MOTION: ClipMotion = "Ease In Out";

// An Order's `motionIn` and `motionOut` ease its clips' slides into and out
// of its arrangement, and it has no Full timing.
export type ClipAnimation = {
  motionIn: ClipMotion;
  motionOut: ClipMotion;
  timing: ClipTiming;
  // Order only.
  transition?: OrderTransition;
  // Order only: its slides follow `motionIn` and `motionOut`. An Order
  // saved without it slid Ease In Out both ways whatever they said, and
  // loads with those motions so it renders the same.
  slideMotions?: true;
};

export type ReactiveAnimation = {
  motion: ReactiveMotion;
  timing: AnimationTiming;
  // How many hits move the parameters, 0..1: none at 0, every hit at 1, and
  // in between only hits of strength `1 - reactivity` and up.
  reactivity: number;
  // How far a hit swings the parameters, -MAX_REACTIVE_AMPLITUDE to
  // MAX_REACTIVE_AMPLITUDE; below 0 the swing goes the other way.
  amplitude: number;
  // Keys of the knob parameters the music moves.
  parameters: string[];
  // Reactivity counts up from no hits to every hit. Settings saved without
  // it stored the weakest hit's strength instead, and load inverted.
  version?: typeof REACTIVE_VERSION;
};

export type LfoAnimation = {
  shape: LfoShape;
  // Whether the Rate follows the session tempo (`syncRate`) or runs free
  // (`rate`).
  sync: boolean;
  // Cycles per second while Sync is off.
  rate: number;
  // One cycle's length while Sync is on.
  syncRate: LfoSyncRate;
  // How far the parameters swing, 0..1.
  depth: number;
  // Where in its cycle the LFO starts, in degrees, 0..360.
  phase: number;
  // Keys of the knob parameters the LFO moves.
  parameters: string[];
};

// Stored on an effect instance, and saved in `project.json` as zvid-only
// `animation`. Turning the modifier off keeps the settings for next time.
// Effects that only support Clip mode have no `reactive` or `lfo` settings.
export type EffectAnimation = {
  enabled: boolean;
  mode: AnimationMode;
  clip: ClipAnimation;
  reactive?: ReactiveAnimation;
  lfo?: LfoAnimation;
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
  // Absent when the effect doesn't support LFO mode.
  lfo?: Readonly<LfoAnimation>;
  // A new device comes with its Animation off, as for static grading tools,
  // rather than on.
  offWhenAdded?: boolean;
};

export const DEFAULT_REACTIVE_FRAMES: AnimationTimingFrames = {
  Slow: 18,
  Normal: 12,
  Fast: 6,
};

// Marks Reactive settings whose Reactivity counts up from no hits (see
// ReactiveAnimation).
export const REACTIVE_VERSION = 2;
export const REACTIVITY_STEP = 0.01;
export const AMPLITUDE_STEP = 0.1;
export const MAX_REACTIVE_AMPLITUDE = 10;
// LFO Depth scales the swing up to 10x either way; below 0 it inverts the
// waveform, so knobs move against the LFO.
export const MAX_LFO_DEPTH = 10;
export const LFO_DEPTH_STEP = 0.1;

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
  amplitude: number,
  parameters: readonly string[],
): FxAnimationDefaults {
  return {
    ...clipDefaults(motionIn, motionOut, frames),
    modes: ANIMATION_MODES,
    reactive: {
      motion,
      timing: "Normal",
      reactivity: 1,
      amplitude,
      parameters: [...parameters],
      version: REACTIVE_VERSION,
    },
    // The LFO sweeps the same knobs as far as the music would push them.
    lfo: {
      shape: "Sine",
      sync: true,
      rate: 1,
      syncRate: "1/8",
      depth: amplitude,
      phase: 0,
      parameters: [...parameters],
    },
  };
}

function withTransition(
  effectDefaults: FxAnimationDefaults,
  transition: OrderTransition,
): FxAnimationDefaults {
  return {
    ...effectDefaults,
    clip: { ...effectDefaults.clip, transition, slideMotions: true },
  };
}

// `effectDefaults` for an effect whose new devices come with Animation off.
function offWhenAdded(
  effectDefaults: FxAnimationDefaults,
): FxAnimationDefaults {
  return { ...effectDefaults, offWhenAdded: true };
}

function withClipTiming(
  effectDefaults: FxAnimationDefaults,
  timing: ClipTiming,
): FxAnimationDefaults {
  return { ...effectDefaults, clip: { ...effectDefaults.clip, timing } };
}

const ANIMATION_DEFAULTS: ReadonlyMap<string, FxAnimationDefaults> = new Map([
  // Order arranges layers; jiggling its arrangement on audio hits isn't a
  // meaningful effect, so it only animates in Clip mode.
  [
    ORDER_EFFECT_NAME,
    withTransition(clipDefaults("Ease Out", "Ease In", [7, 5, 3]), "Squish"),
  ],
  // A Transition blends between comps rather than animating its knobs: its
  // Clip mode times the blend, which spans the FX clip by default, and
  // eases A out then B in.
  [
    TRANSITION_EFFECT_NAME,
    withClipTiming(
      clipDefaults("Ease In", "Ease Out", TRANSITION_FRAMES),
      FULL_CLIP_TIMING,
    ),
  ],
  [
    "Transform",
    defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.3, [
      "ScaleX",
      "ScaleY",
    ]),
  ],
  // A Move already travels from its start to its end across the clip, so
  // new devices come with Animation off.
  [
    MOVE_EFFECT_NAME,
    offWhenAdded(
      defaults("Linear", "Linear", [12, 8, 4], "Wobble", 0.2, [
        "StartRotation",
        "EndRotation",
      ]),
    ),
  ],
  [
    "ZoomAndPan",
    defaults("Ease In Out", "Ease In Out", [16, 10, 6], "Single", 0.3, [
      "_End_Zoom",
    ]),
  ],
  [
    "Colorize",
    defaults("Ease Out", "Ease In", [12, 8, 4], "Wobble", 0.5, ["_HueOffset"]),
  ],
  // Exposure, Contrast, LUT and Levels are static grading tools, so their
  // new devices come with Animation off.
  [
    "Exposure",
    offWhenAdded(
      defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.5, ["_Stops"]),
    ),
  ],
  // Pivot is animatable too, but the music moves Contrast by default.
  [
    "Contrast",
    offWhenAdded(
      defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.3, ["_Contrast"]),
    ),
  ],
  [
    "LUT",
    offWhenAdded(
      defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.5, [
        "_Intensity",
      ]),
    ),
  ],
  [
    "Pixelate",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Single", 0.5, ["_NumPixels"]),
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
    "Distortion",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Wobble", 0.5, ["_Amount"]),
  ],
  [
    "Caustics",
    defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.5, [
      "_Intensity",
      "_Warp",
    ]),
  ],
  [
    "Refraction",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Wobble", 0.5, ["_Amount"]),
  ],
  [
    "DigitalGlitch",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Single", 0.6, [
      "_Amount",
      "_Displace",
    ]),
  ],
  [
    "Bloom",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Single", 0.5, ["_Intensity"]),
  ],
  [
    "GaussianBlur",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Single", 0.5, ["_Radius"]),
  ],
  [
    "MotionBlur",
    defaults("Ease Out", "Ease In", [10, 6, 3], "Single", 0.5, ["_Distance"]),
  ],
  [
    LEVELS_EFFECT_NAME,
    offWhenAdded(
      defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.3, ["GainY"]),
    ),
  ],
  [
    COLOR_EFFECT_NAME,
    defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.3, ["Opacity"]),
  ],
  // Clip mode fades the clip or layer in and out; the music or the LFO
  // flickers it.
  [
    OPACITY_EFFECT_NAME,
    defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.3, ["Opacity"]),
  ],
  // A Shape animates its outline: Clip mode draws it on, and the music or
  // the LFO marches its dashes. A filled shape has no outline to move, so
  // new devices come with Animation off.
  [
    SHAPE_EFFECT_NAME,
    offWhenAdded(
      defaults("Ease Out", "Ease In", [24, 16, 8], "Single", 0.3, [OFFSET_KEY]),
    ),
  ],
  [
    TEXT_EFFECT_NAME,
    defaults("Ease Out", "Ease In", [12, 8, 4], "Single", 0.3, [
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

// The parameters Reactive and LFO modes can modulate: the effect's visible
// knobs.
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

  const { reactive, lfo } = effectDefaults;
  return {
    enabled: true,
    mode: "clip",
    clip: { ...effectDefaults.clip },
    ...(reactive
      ? { reactive: { ...reactive, parameters: [...reactive.parameters] } }
      : {}),
    ...(lfo ? { lfo: { ...lfo, parameters: [...lfo.parameters] } } : {}),
  };
}

// The animation a new device of the effect comes with: its defaults, off
// for an effect whose devices are added with Animation off. Undefined when
// the effect doesn't support animation.
export function createNewDeviceAnimation(
  effectName: string,
): EffectAnimation | undefined {
  const animation = createDefaultAnimation(effectName);
  return animation && getAnimationDefaults(effectName)?.offWhenAdded
    ? { ...animation, enabled: false }
    : animation;
}

// Frames each side of a Clip-mode animation takes. Full is unbounded, so
// the sides stretch to half the clip each.
// The Clip-mode timings `effectName` offers. An Order has no Full timing: it
// doesn't animate itself, only the clips entering and leaving beneath it.
export function getClipTimings(effectName: string): readonly ClipTiming[] {
  return effectName === ORDER_EFFECT_NAME ? ANIMATION_TIMINGS : CLIP_TIMINGS;
}

export function getClipTimingFrames(effectName: string, timing: ClipTiming) {
  const clipFrames = getAnimationDefaults(effectName)?.clipFrames;
  if (!clipFrames) {
    return undefined;
  }
  return timing === FULL_CLIP_TIMING
    ? Number.POSITIVE_INFINITY
    : clipFrames[timing];
}

export function getReactiveTimingFrames(
  effectName: string,
  timing: AnimationTiming,
) {
  return (getAnimationDefaults(effectName)?.reactiveFrames ??
    DEFAULT_REACTIVE_FRAMES)[timing];
}

export function readOption<T extends string>(
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

export function readNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function readReactivity(value: unknown, fallback: number) {
  return readNumber(value, 0, 1, fallback);
}

export function readAmplitude(value: unknown, fallback: number) {
  return readNumber(
    value,
    -MAX_REACTIVE_AMPLITUDE,
    MAX_REACTIVE_AMPLITUDE,
    fallback,
  );
}

export function readParameters(value: unknown, fallback: readonly string[]) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((key): key is string => typeof key === "string"),
        ),
      ]
    : [...fallback];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The animation an effect was saved or synced with, with anything missing or
// malformed filled in from the effect's defaults. Undefined when there is
// none, or the effect doesn't support animation. A mode the effect doesn't
// support, such as Reactive on an Order, loads as Clip, and its settings are
// dropped. Sessions saved before LFO mode existed load its defaults.
export function normalizeEffectAnimation(
  raw: unknown,
  effectName: string,
): EffectAnimation | undefined {
  const fallback = createDefaultAnimation(effectName);
  if (!fallback || !isRecord(raw)) {
    return undefined;
  }

  const clip = isRecord(raw.clip) ? raw.clip : {};
  // An Order saved before its slides followed Motion In and Out keeps
  // easing them the way it did.
  const legacySlides =
    fallback.clip.slideMotions === true && clip.slideMotions !== true;
  return {
    enabled: raw.enabled === true,
    mode: readOption(raw.mode, getAnimationModes(effectName), fallback.mode),
    clip: {
      motionIn: legacySlides
        ? LEGACY_ORDER_SLIDE_MOTION
        : readOption(clip.motionIn, CLIP_MOTIONS, fallback.clip.motionIn),
      motionOut: legacySlides
        ? LEGACY_ORDER_SLIDE_MOTION
        : readOption(clip.motionOut, CLIP_MOTIONS, fallback.clip.motionOut),
      timing: readOption(
        clip.timing,
        getClipTimings(effectName),
        fallback.clip.timing,
      ),
      ...(fallback.clip.transition
        ? {
            transition: readOption(
              clip.transition,
              ORDER_TRANSITIONS,
              LEGACY_ORDER_TRANSITION,
            ),
            slideMotions: true as const,
          }
        : {}),
    },
    ...(fallback.reactive
      ? { reactive: normalizeReactive(raw.reactive, fallback.reactive) }
      : {}),
    ...(fallback.lfo ? { lfo: normalizeLfo(raw.lfo, fallback.lfo) } : {}),
  };
}

export function normalizeReactive(
  raw: unknown,
  fallback: ReactiveAnimation,
): ReactiveAnimation {
  const reactive = isRecord(raw) ? raw : {};
  // Saved before Reactivity became a threshold, when it scaled the swing
  // as Amplitude does: every hit triggered, so it opens at Reactivity 1
  // with its Amplitude at the old Reactivity.
  const legacy =
    reactive.amplitude === undefined && typeof reactive.reactivity === "number";
  // Saved while Reactivity was the weakest hit that triggers, before it
  // counted up from no hits: it opens inverted, letting through the same
  // hits.
  const threshold =
    !legacy &&
    reactive.version !== REACTIVE_VERSION &&
    typeof reactive.reactivity === "number";
  const reactivity = readReactivity(reactive.reactivity, fallback.reactivity);
  return {
    motion: readOption(reactive.motion, REACTIVE_MOTIONS, fallback.motion),
    timing: readOption(reactive.timing, ANIMATION_TIMINGS, fallback.timing),
    reactivity: legacy
      ? 1
      : threshold
        ? // Rounded so 0.7 opens at 0.3, not 0.30000000000000004.
          Math.round((1 - reactivity) * 1e6) / 1e6
        : reactivity,
    amplitude: legacy
      ? readReactivity(reactive.reactivity, fallback.amplitude)
      : readAmplitude(reactive.amplitude, fallback.amplitude),
    parameters: readParameters(reactive.parameters, fallback.parameters),
    version: REACTIVE_VERSION,
  };
}

export function normalizeLfo(
  raw: unknown,
  fallback: LfoAnimation,
): LfoAnimation {
  const lfo = isRecord(raw) ? raw : {};
  return {
    shape: readOption(lfo.shape, LFO_SHAPES, fallback.shape),
    sync: typeof lfo.sync === "boolean" ? lfo.sync : fallback.sync,
    rate: readNumber(lfo.rate, LFO_MIN_RATE, LFO_MAX_RATE, fallback.rate),
    syncRate: readOption(lfo.syncRate, LFO_SYNC_RATES, fallback.syncRate),
    depth: readNumber(lfo.depth, -MAX_LFO_DEPTH, MAX_LFO_DEPTH, fallback.depth),
    phase: readNumber(lfo.phase, 0, LFO_MAX_PHASE, fallback.phase),
    parameters: readParameters(lfo.parameters, fallback.parameters),
  };
}

// The Parameters button's label: how many of the effect's knobs Reactive or
// LFO mode modulates.
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
