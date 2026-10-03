// The Modulation modifier an audio effect can carry: its settings, and each
// effect's defaults for them. It is the audio side's Animation: Transient
// moves the selected knobs on hits exactly as Animation's Reactive mode
// does, and LFO moves them continuously on session time with Animation's LFO
// settings. Effects that aren't listed here, Reverse among them, don't
// support modulation.

import {
  type AnimatableParameter,
  type AnimationTiming,
  DEFAULT_REACTIVE_FRAMES,
  isRecord,
  type LfoAnimation,
  normalizeLfo,
  normalizeReactive,
  type ReactiveAnimation,
  type ReactiveMotion,
  readOption,
} from "./fx-animation-defaults.ts";
import { getEffectDefinition } from "./fx-registry.ts";

export const MODULATION_MODES = ["transient", "lfo"] as const;
export type ModulationMode = (typeof MODULATION_MODES)[number];

export const MODULATION_MODE_LABELS: Readonly<Record<ModulationMode, string>> =
  { transient: "Transient", lfo: "LFO" };

// Transient's settings are Reactive's, so it moves the knobs the same way.
export type TransientModulation = ReactiveAnimation;

// LFO's settings are Animation's LFO mode's.
export type LfoModulation = LfoAnimation;

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
      rate: 1,
      syncRate: "1 Bar",
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
