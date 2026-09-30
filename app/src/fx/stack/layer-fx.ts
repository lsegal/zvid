import { isColorEffectName } from "../../fill-paint.ts";
import { isTextEffectName } from "../../text-style.ts";
import { getTrackGroup } from "./clip-stacks.ts";
import type { SessionEffect } from "./types.ts";

// A layer's FX switch bypasses its whole stack at once. It lives on the
// layer rather than on each effect, so turning it back on restores every
// device's own bypass state. A missing flag means on.
export type FxLayer = {
  id: string;
  fxEnabled?: boolean;
};

export function isLayerFxEnabled(layer: FxLayer | undefined) {
  return layer?.fxEnabled !== false;
}

export function setLaneFxEnabled<T extends FxLayer>(
  layers: T[],
  laneId: string,
  enabled: boolean,
) {
  const index = layers.findIndex((layer) => layer.id === laneId);
  if (index < 0 || isLayerFxEnabled(layers[index]) === enabled) {
    return layers;
  }

  const result = layers.slice();
  result[index] = { ...layers[index], fxEnabled: enabled };
  return result;
}

// The effects the renderer applies: a layer whose FX are off contributes
// nothing but its Layout anchoring, the Color its fill clips are painted
// with and any Text a session from before clip Text still has there. Clip
// stacks are not the layer's and stay. Returns `effects` itself when no
// layer is bypassed.
export function getRenderedEffects<
  T extends { trackId: string; effectName: string },
>(effects: T[], layers: FxLayer[]) {
  const bypassed = new Set(
    layers.filter((layer) => !isLayerFxEnabled(layer)).map((layer) => layer.id),
  );
  if (!bypassed.size) {
    return effects;
  }

  return effects.filter(
    (effect) =>
      !bypassed.has(effect.trackId) ||
      isLayoutEffectName(effect.effectName) ||
      isColorEffectName(effect.effectName) ||
      isTextEffectName(effect.effectName),
  );
}

export const LAYOUT_EFFECT_NAME = "Layout";

// A Layout effect on a layer's own stack, as opposed to a legacy one on the
// Global stack.
export function isLayerLayoutEffect(effect: SessionEffect) {
  return (
    getTrackGroup(effect.trackId) === "layer" &&
    isLayoutEffectName(effect.effectName)
  );
}

export function isLayoutEffectName(effectName: string) {
  return effectName.trim().toLowerCase().includes("layout");
}
