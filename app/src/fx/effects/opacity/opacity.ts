// The Opacity effect's parameter and how a stack's Opacity effects combine:
// each one multiplies what its layer or clip is drawn at, so a clip's own
// sits inside its layer's.
export const OPACITY_EFFECT_NAME = "Opacity";
export const OPACITY_KEY = "Opacity";

export function isOpacityEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "opacity";
}

export type OpacityParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

// The opacity an Opacity effect draws at, 0..1; a missing or unreadable
// value leaves it opaque.
export function parseOpacity(parameters: OpacityParameter[]) {
  const parameter = parameters.find(
    (candidate) => candidate.key.toLowerCase() === "opacity",
  );
  if (!parameter) {
    return 1;
  }
  const numeric = parameter.numericValue ?? Number.parseFloat(parameter.value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 1;
}
