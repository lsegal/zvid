import { analogGlitchPass } from "./analog-glitch.ts";
import { colorizePass } from "./colorize.ts";
import { negativeSplitPass } from "./negative-split.ts";
import { pixelatePass } from "./pixelate.ts";
import {
  type EffectParameter,
  type EffectPass,
  normalizeEffectKey,
} from "./types.ts";
import { zoomAndPanPass } from "./zoom-and-pan.ts";

export type ChainEffect = {
  trackId: string;
  effectName: string;
  enabled?: boolean;
  parameters: EffectParameter[];
};

export type EffectChainStep = {
  pass: EffectPass;
  parameters: EffectParameter[];
};

const effectPasses = new Map<string, EffectPass>(
  [
    colorizePass,
    negativeSplitPass,
    pixelatePass,
    analogGlitchPass,
    zoomAndPanPass,
  ].map((pass) => [
    normalizeEffectKey(pass.effectName),
    pass,
  ]),
);

// Matches `.lvp` names case- and space-insensitively, so "NegativeSplit" and
// "Negative Split" resolve to the same pass.
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
      steps.push({ pass, parameters: effect.parameters });
    }
  }

  return steps;
}
