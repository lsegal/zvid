// Turns a session's audio effects into chain stages (see chain.ts): each
// number parameter at its stored value, or its default, and each enum,
// toggle or other string parameter as a switch.
import { isGainEffectName } from "../fx/effects/gain/gain.ts";
import { getEffectDefinition } from "../fx-registry.ts";
import type { AudioProcessorRegistry, AudioStage } from "./processor.ts";

export type AudioStageEffect = {
  id?: string;
  trackId: string;
  effectName: string;
  enabled?: boolean;
  parameters: readonly { key: string; value: string; numericValue?: number }[];
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
  return {
    id: effect.id ?? fallbackId,
    effectName: effect.effectName,
    enabled: enabled && effect.enabled !== false,
    numbers,
    switches,
  };
}

// Whether `stages` change the sound in some way other than Gain: a stage
// with a registered processor that is on.
export function hasProcessingStages(
  registry: AudioProcessorRegistry,
  stages: readonly AudioStage[],
) {
  return stages.some(
    (stage) =>
      stage.enabled &&
      !isGainEffectName(stage.effectName) &&
      registry.has(stage.effectName),
  );
}
