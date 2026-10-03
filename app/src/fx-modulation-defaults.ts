// The Modulation modifier an audio effect can carry: its settings, and each
// effect's defaults for them. It is the audio side's Animation: Transient
// moves the selected knobs on hits exactly as Animation's Reactive mode
// does, and LFO moves them continuously on session time. Effects that
// aren't listed here, Reverse among them, don't support modulation.

import { NOTE_VALUE_OPTIONS } from "./audio-mix/tempo.ts";
import {
  type AnimatableParameter,
  type AnimationTiming,
  DEFAULT_REACTIVE_FRAMES,
  isRecord,
  normalizeReactive,
  type ReactiveAnimation,
  type ReactiveMotion,
  readOption,
  readReactivity,
} from "./fx-animation-defaults.ts";
import { getEffectDefinition } from "./fx-registry.ts";

export const MODULATION_MODES = ["transient", "lfo"] as const;
export type ModulationMode = (typeof MODULATION_MODES)[number];

export const MODULATION_MODE_LABELS: Readonly<Record<ModulationMode, string>> =
  { transient: "Transient", lfo: "LFO" };

export const LFO_SHAPES = [
  "Sine",
  "Triangle",
  "Saw Up",
  "Saw Down",
  "Square",
  "Random",
] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];

// Free-running rates, in Hz.
export const LFO_RATE_MIN = 0.05;
export const LFO_RATE_MAX = 20;
export const LFO_RATE_DEFAULT = 1;
export const LFO_NOTE_OPTIONS = NOTE_VALUE_OPTIONS;
export const LFO_NOTE_DEFAULT = "1 bar";
export const LFO_PHASE_MAX = 360;

// Transient's settings are Reactive's, so it moves the knobs the same way.
export type TransientModulation = ReactiveAnimation;

export type LfoModulation = {
  shape: LfoShape;
  // Tempo-synced to `note` when on, else free-running at `rate` Hz.
  sync: boolean;
  rate: number;
  // A note value from LFO_NOTE_OPTIONS, such as "1/8D" or "2 bars".
  note: string;
  // How far the knobs swing, 0..1, scaled to each knob's range the way
  // Reactivity scales Transient's swing.
  depth: number;
  // Where the cycle starts, in degrees, 0..360.
  phase: number;
  // Keys of the knob parameters the LFO moves.
  parameters: string[];
};

// Stored on an audio effect instance, and saved to `.lvp` as zvid-only
// `modulation`. Turning the modifier off keeps the settings for next time.
export type EffectModulation = {
  enabled: boolean;
  mode: ModulationMode;
  transient: TransientModulation;
  lfo: LfoModulation;
};

type FxModulationDefaults = {
  transient: Readonly<TransientModulation>;
  lfo: Readonly<LfoModulation>;
};

function defaults(
  motion: ReactiveMotion,
  amount: number,
  parameters: readonly string[],
): FxModulationDefaults {
  return {
    transient: {
      motion,
      timing: "Normal",
      reactivity: amount,
      parameters: [...parameters],
    },
    lfo: {
      shape: "Sine",
      sync: true,
      rate: LFO_RATE_DEFAULT,
      note: LFO_NOTE_DEFAULT,
      depth: amount,
      phase: 0,
      parameters: [...parameters],
    },
  };
}

const MODULATION_DEFAULTS: ReadonlyMap<string, FxModulationDefaults> = new Map([
  ["Gain", defaults("Bounce", 0.3, ["Gain"])],
  ["EQ", defaults("Bounce", 0.3, ["Mid Freq"])],
  ["High Cut", defaults("Bounce", 0.5, ["Frequency"])],
  ["Low Cut", defaults("Bounce", 0.5, ["Frequency"])],
  ["Compressor", defaults("Bounce", 0.3, ["Threshold"])],
  ["Limiter", defaults("Bounce", 0.3, ["Gain"])],
  ["Noise Gate", defaults("Bounce", 0.3, ["Threshold"])],
  ["De-ess", defaults("Bounce", 0.3, ["Amount"])],
  ["Transient Shaper", defaults("Bounce", 0.3, ["Attack"])],
  ["Saturation", defaults("Bounce", 0.4, ["Drive"])],
  ["Bitcrush", defaults("Bounce", 0.4, ["Downsample"])],
  ["Delay", defaults("Bounce", 0.3, ["Mix"])],
  ["Reverb", defaults("Bounce", 0.3, ["Mix"])],
  ["Chorus", defaults("Wobble", 0.4, ["Depth"])],
  ["Phaser", defaults("Wobble", 0.4, ["Center"])],
  ["Tremolo", defaults("Bounce", 0.3, ["Depth"])],
  ["Auto Pan", defaults("Bounce", 0.3, ["Depth"])],
  ["Stereo", defaults("Wobble", 0.4, ["Pan"])],
  ["Mono", defaults("Bounce", 0.4, ["Amount"])],
]);

export function supportsModulation(effectName: string) {
  return MODULATION_DEFAULTS.has(effectName);
}

// The parameters Modulation can move: the effect's visible knobs, leaving
// out on/off toggles such as Gain's Mute.
export function getModulatableParameters(
  effectName: string,
): AnimatableParameter[] {
  return getEffectDefinition(effectName)
    .parameters.filter(
      (parameter) =>
        parameter.kind === "number" &&
        !parameter.hidden &&
        parameter.control !== "toggle",
    )
    .map((parameter) => ({ key: parameter.key, label: parameter.label }));
}

// The settings an effect's modulation starts from when first turned on, or
// undefined when the effect doesn't support modulation.
export function createDefaultModulation(
  effectName: string,
): EffectModulation | undefined {
  const effectDefaults = MODULATION_DEFAULTS.get(effectName);
  if (!effectDefaults) {
    return undefined;
  }
  return {
    enabled: true,
    mode: "transient",
    transient: {
      ...effectDefaults.transient,
      parameters: [...effectDefaults.transient.parameters],
    },
    lfo: {
      ...effectDefaults.lfo,
      parameters: [...effectDefaults.lfo.parameters],
    },
  };
}

export function cloneModulation(
  modulation: EffectModulation,
): EffectModulation {
  return {
    ...modulation,
    transient: {
      ...modulation.transient,
      parameters: [...modulation.transient.parameters],
    },
    lfo: { ...modulation.lfo, parameters: [...modulation.lfo.parameters] },
  };
}

// Frames a Transient swing takes at each timing, as Reactive's do.
export function getTransientTimingFrames(timing: AnimationTiming) {
  return DEFAULT_REACTIVE_FRAMES[timing];
}

function readNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function readParameters(value: unknown, fallback: readonly string[]) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((key): key is string => typeof key === "string"),
        ),
      ]
    : [...fallback];
}

function normalizeLfo(raw: unknown, fallback: LfoModulation): LfoModulation {
  const lfo = isRecord(raw) ? raw : {};
  return {
    shape: readOption(lfo.shape, LFO_SHAPES, fallback.shape),
    sync: typeof lfo.sync === "boolean" ? lfo.sync : fallback.sync,
    rate: readNumber(lfo.rate, fallback.rate, LFO_RATE_MIN, LFO_RATE_MAX),
    note: readOption(lfo.note, LFO_NOTE_OPTIONS, fallback.note),
    depth: readReactivity(lfo.depth, fallback.depth),
    phase: readNumber(lfo.phase, fallback.phase, 0, LFO_PHASE_MAX),
    parameters: readParameters(lfo.parameters, fallback.parameters),
  };
}

// The modulation an effect was saved or synced with, with anything missing
// or malformed filled in from the effect's defaults. Undefined when there is
// none, or the effect doesn't support modulation.
export function normalizeEffectModulation(
  raw: unknown,
  effectName: string,
): EffectModulation | undefined {
  const fallback = createDefaultModulation(effectName);
  if (!fallback || !isRecord(raw)) {
    return undefined;
  }
  return {
    enabled: raw.enabled === true,
    mode: readOption(raw.mode, MODULATION_MODES, fallback.mode),
    transient: normalizeReactive(raw.transient, fallback.transient),
    lfo: normalizeLfo(raw.lfo, fallback.lfo),
  };
}
