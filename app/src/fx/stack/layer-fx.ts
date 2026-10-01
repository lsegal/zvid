import { isColorEffectName } from "../../fill-paint.ts";
import { isTextEffectName } from "../../text-style.ts";
import { getEffectClipId, getTrackGroup } from "./clip-stacks.ts";
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

// The clip whose stack an effect may sit on: its layer, and whether it is an
// FX clip.
export type FxClip = {
  id: string;
  laneId: string;
  kind?: string;
};

// The effects the renderer applies: a layer whose FX are off turns off its
// own stack and the stacks of the clips on it, apart from the content that
// defines a clip: Layout anchoring, the Color fill clips are painted with
// and a text clip's Text. FX clips on it apply nothing. Returns `effects`
// itself when no layer is bypassed.
export function getRenderedEffects<
  T extends { trackId: string; effectName: string },
>(effects: T[], layers: readonly FxLayer[], clips: readonly FxClip[]) {
  const bypassed = new Set(
    layers.filter((layer) => !isLayerFxEnabled(layer)).map((layer) => layer.id),
  );
  if (!bypassed.size) {
    return effects;
  }

  const bypassedClips = new Map(
    clips
      .filter((clip) => bypassed.has(clip.laneId))
      .map((clip) => [clip.id, clip]),
  );
  return effects.filter((effect) => {
    const clipId = getEffectClipId(effect.trackId);
    const clip = clipId === undefined ? undefined : bypassedClips.get(clipId);
    if (clip) {
      return clip.kind !== "fx" && isContentEffectName(effect.effectName);
    }

    return (
      !bypassed.has(effect.trackId) || isContentEffectName(effect.effectName)
    );
  });
}

// Whether a bypassed layer still applies an effect, because it defines what
// a clip is rather than adjusting it.
export function isContentEffectName(effectName: string) {
  return (
    isLayoutEffectName(effectName) ||
    isColorEffectName(effectName) ||
    isTextEffectName(effectName)
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
