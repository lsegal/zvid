// Turns a session's audio effects into chain stages (see chain.ts): each
// number parameter at its stored value, or its default, and each enum,
// toggle or other string parameter as a switch, and its Modulation while
// it is on.
import { isGainEffectName } from "../fx/effects/gain/gain.ts";
import { gainStageAmplitude } from "../fx/effects/gain/processor.ts";
import {
  type EffectModulation,
  getModulatableParameters,
  getTransientTimingFrames,
} from "../fx-modulation-defaults.ts";
import { getEffectDefinition } from "../fx-registry.ts";
import type { AudioStageModulation, ModulatedParameter } from "./modulation.ts";
import type { AudioProcessorRegistry, AudioStage } from "./processor.ts";

export type AudioStageEffect = {
  id?: string;
  trackId: string;
  effectName: string;
  enabled?: boolean;
  parameters: readonly { key: string; value: string; numericValue?: number }[];
  modulation?: EffectModulation;
};

function storedNumber(stored: AudioStageEffect["parameters"][number]) {
  const value = stored.numericValue ?? Number.parseFloat(stored.value);
  return Number.isFinite(value) ? value : undefined;
}

// `effect` as a stage; `fallbackId` names it when the effect has no id.
// `enabled: false` bypasses it whatever its own flag says, as for a track
// whose FX switch is off.
export function audioStageOf(
  effect: AudioStageEffect,
  fallbackId: string,
  enabled = true,
): AudioStage {
  const storedByKey = new Map(
    effect.parameters.map((parameter) => [parameter.key, parameter]),
  );
  const numbers: Record<string, number> = {};
  const switches: Record<string, string> = {};
  for (const parameter of getEffectDefinition(effect.effectName).parameters) {
    const stored = storedByKey.get(parameter.key);
    if (parameter.kind !== "number") {
      switches[parameter.key] = stored?.value ?? parameter.defaultValue;
      continue;
    }
    const value =
      (stored && storedNumber(stored)) ?? parameter.defaultValue ?? 0;
    if (parameter.control === "toggle") {
      switches[parameter.key] = value >= 0.5 ? "1" : "0";
    } else {
      numbers[parameter.key] = value;
    }
  }
  const modulation = audioStageModulation(effect);
  return {
    id: effect.id ?? fallbackId,
    effectName: effect.effectName,
    enabled: enabled && effect.enabled !== false,
    numbers,
    switches,
    ...(modulation ? { modulation } : {}),
  };
}

// `effect`'s Modulation as its stage runs it, or undefined while it is off
// or would move nothing.
function audioStageModulation(
  effect: AudioStageEffect,
): AudioStageModulation | undefined {
  const modulation = effect.modulation;
  if (!modulation?.enabled) {
    return undefined;
  }
  const settings =
    modulation.mode === "lfo" ? modulation.lfo : modulation.transient;
  const selected = new Set(settings.parameters);
  const modulatable = new Set(
    getModulatableParameters(effect.effectName).map(
      (parameter) => parameter.key,
    ),
  );
  const parameters: ModulatedParameter[] = [];
  for (const parameter of getEffectDefinition(effect.effectName).parameters) {
    if (
      parameter.kind === "number" &&
      selected.has(parameter.key) &&
      modulatable.has(parameter.key)
    ) {
      parameters.push({
        key: parameter.key,
        min: parameter.min,
        max: parameter.max,
        ...(parameter.taper ? { taper: parameter.taper } : {}),
      });
    }
  }
  if (!parameters.length) {
    return undefined;
  }

  if (modulation.mode === "lfo") {
    const { lfo } = modulation;
    return lfo.depth > 0
      ? {
          mode: "lfo",
          shape: lfo.shape,
          sync: lfo.sync,
          rate: lfo.rate,
          syncRate: lfo.syncRate,
          depth: lfo.depth,
          phase: lfo.phase,
          parameters,
        }
      : undefined;
  }
  const { transient } = modulation;
  return transient.motion !== "None" && transient.reactivity > 0
    ? {
        mode: "transient",
        motion: transient.motion,
        reactivity: transient.reactivity,
        lengthFrames: getTransientTimingFrames(transient.timing),
        parameters,
      }
    : undefined;
}

// Whether `stages` change the sound in some way other than a steady Gain:
// a stage with a registered processor that is on, and isn't a Gain without
// Modulation.
export function hasProcessingStages(
  registry: AudioProcessorRegistry,
  stages: readonly AudioStage[],
) {
  return stages.some(
    (stage) =>
      stage.enabled &&
      (!isGainEffectName(stage.effectName) || stage.modulation !== undefined) &&
      registry.has(stage.effectName),
  );
}

// The amplitude `stages`' steady Gains apply, as a chain runs them: the
// enabled ones with a registered processor multiply, and without one they
// pass at unity.
export function steadyGainAmplitude(
  registry: AudioProcessorRegistry,
  stages: readonly AudioStage[],
) {
  let amplitude = 1;
  for (const stage of stages) {
    if (
      stage.enabled &&
      isGainEffectName(stage.effectName) &&
      registry.has(stage.effectName)
    ) {
      amplitude *= gainStageAmplitude(stage);
    }
  }
  return amplitude;
}
