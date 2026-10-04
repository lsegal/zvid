// The Mask effect: shows a layer only where one other layer, its Target,
// draws (Additive), or everywhere but there (Subtractive). The mask is the
// target's own drawn alpha, after its effects, Transform and animation, in
// canvas space, not its box. The target keeps drawing as usual. On an FX
// clip it limits where the clip's effects apply instead: the processed
// picture shows by the mask, and the picture beneath elsewhere.

export const MASK_EFFECT_NAME = "Mask";

// The parameter holding the target layer's id; empty means no masking.
export const MASK_TARGET_KEY = "Target";
export const MASK_MODE_KEY = "Mode";

export const MASK_MODES = ["Additive", "Subtractive"] as const;

export type MaskMode = "additive" | "subtractive";

export type LayerMask = {
  // The layer whose drawn pixels mask this one.
  targetLaneId: string;
  mode: MaskMode;
};

type MaskParameter = { key: string; value: string };

type MaskEffect = {
  trackId: string;
  effectName: string;
  parameters: MaskParameter[];
  enabled?: boolean;
};

export function isMaskEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === MASK_EFFECT_NAME.toLowerCase();
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Reads a Mask effect's parameters, or undefined when it has no Target.
export function parseLayerMask(
  parameters: readonly MaskParameter[],
): LayerMask | undefined {
  let targetLaneId = "";
  let mode: MaskMode = "additive";
  for (const parameter of parameters) {
    const key = normalizeKey(parameter.key);
    if (key === "target") {
      targetLaneId = parameter.value.trim();
    } else if (key === "mode") {
      mode =
        parameter.value.trim().toLowerCase() === "subtractive"
          ? "subtractive"
          : "additive";
    }
  }
  return targetLaneId ? { targetLaneId, mode } : undefined;
}

// The mask a clip on layer `laneId` is drawn with: the last enabled Mask on
// the clip's own stack, `clipTrackId`, or else on its layer's. A layer
// can't mask itself.
export function findLayerMask(
  effects: readonly MaskEffect[],
  laneId: string,
  clipTrackId?: string,
): LayerMask | undefined {
  const find = (trackId: string) =>
    effects.findLast(
      (effect) =>
        effect.trackId === trackId &&
        effect.enabled !== false &&
        isMaskEffectName(effect.effectName),
    );
  const effect =
    (clipTrackId === undefined ? undefined : find(clipTrackId)) ?? find(laneId);
  const mask = effect && parseLayerMask(effect.parameters);
  return mask && mask.targetLaneId !== laneId ? mask : undefined;
}

// What a masked layer's alpha is multiplied by where the target's drawn
// alpha is `targetAlpha`. Where the target draws nothing, as on a frame it
// has no active clip, that is 0: Additive hides the layer there and
// Subtractive leaves it as it is.
export function maskCoverage(targetAlpha: number, mode: MaskMode) {
  const alpha = Math.max(0, Math.min(1, targetAlpha));
  return mode === "subtractive" ? 1 - alpha : alpha;
}

// The effects with each Mask's Target cleared when it names a layer that no
// longer exists. Effects with nothing to clear are kept as they are.
export function pruneMaskTargets<T extends MaskEffect>(
  effects: T[],
  layerIds: Iterable<string>,
): T[] {
  const existing = new Set(layerIds);
  return effects.map((effect) => {
    if (!isMaskEffectName(effect.effectName)) {
      return effect;
    }
    let changed = false;
    const parameters = effect.parameters.map((parameter) => {
      if (
        normalizeKey(parameter.key) !== "target" ||
        !parameter.value.trim() ||
        existing.has(parameter.value.trim())
      ) {
        return parameter;
      }
      changed = true;
      return { key: parameter.key, value: "" };
    });
    return changed ? { ...effect, parameters } : effect;
  });
}

// A channel of what an FX clip a Mask limits shows where the picture
// beneath it is `beneath` and its effects make it `processed`, where the
// target's drawn alpha is `targetAlpha`, or null where it isn't drawing:
// Additive then applies nothing and Subtractive applies everywhere.
export function maskedFxBlend(
  beneath: number,
  processed: number,
  targetAlpha: number | null,
  mode: MaskMode,
) {
  const coverage = maskCoverage(targetAlpha ?? 0, mode);
  return beneath + (processed - beneath) * coverage;
}
