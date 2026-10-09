// The passes live in fx/effects/<effect>/pass.ts and are collected by the
// generated fx/effects/index.generated.ts; see fx/README.md.
import { EFFECT_PASSES } from "../fx/effects/index.generated.ts";
import {
  type EffectParameter,
  type EffectPass,
  normalizeEffectKey,
} from "./types.ts";

export type ChainEffect = {
  // The effect's id, which a view-only pass's readback is published under.
  id?: string;
  trackId: string;
  effectName: string;
  enabled?: boolean;
  parameters: EffectParameter[];
};

export type EffectChainStep = {
  pass: EffectPass;
  parameters: EffectParameter[];
  effectId?: string;
};

const effectPasses = new Map<string, EffectPass>(
  EFFECT_PASSES.map((pass) => [normalizeEffectKey(pass.effectName), pass]),
);

// Matches saved effect names case- and space-insensitively, so
// "NegativeSplit" and "Negative Split" resolve to the same pass.
export function getEffectPass(effectName: string) {
  return effectPasses.get(normalizeEffectKey(effectName));
}

export function isChainEffectName(effectName: string) {
  return effectPasses.has(normalizeEffectKey(effectName));
}

// Returns the enabled shader passes for one `trackId` stack in array order.
// Unknown effects are passthrough, so they are left out of the chain.
export function resolveEffectChain(
  effects: ChainEffect[],
  trackId: string,
): EffectChainStep[] {
  const steps: EffectChainStep[] = [];
  for (const effect of effects) {
    if (effect.trackId !== trackId || effect.enabled === false) {
      continue;
    }

    const pass = getEffectPass(effect.effectName);
    if (pass) {
      steps.push({
        pass,
        parameters: effect.parameters,
        ...(effect.id === undefined ? {} : { effectId: effect.id }),
      });
    }
  }

  return steps;
}
