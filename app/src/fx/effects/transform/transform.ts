// The Transform effect's parameters: the keys it stores and how they map
// onto a LayerTransform. The maths that applies one is in
// composition-transform.ts.
import {
  IDENTITY_TRANSFORM,
  type LayerTransform,
} from "../../../composition-transform.ts";

export const TRANSFORM_EFFECT_NAME = "Transform";

export function isTransformEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "transform";
}

export type TransformParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

// Parameter key, the LayerTransform field it sets, and its range.
const TRANSFORM_KEYS: Array<[string, keyof LayerTransform, number, number]> = [
  ["positionx", "positionX", -2, 2],
  ["positiony", "positionY", -2, 2],
  ["scalex", "scaleX", 0.05, 8],
  ["scaley", "scaleY", 0.05, 8],
  ["originx", "originX", -1, 1],
  ["originy", "originY", -1, 1],
  ["rotation", "rotationDeg", -180, 180],
];

// Reads a Transform effect's parameters by exact key; missing or unreadable
// values keep their identity default.
export function parseLayerTransform(
  parameters: TransformParameter[],
): LayerTransform {
  const transform = { ...IDENTITY_TRANSFORM };
  for (const parameter of parameters) {
    const key = parameter.key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const entry = TRANSFORM_KEYS.find(([candidate]) => candidate === key);
    const numeric =
      parameter.numericValue ?? Number.parseFloat(parameter.value);
    if (!entry || !Number.isFinite(numeric)) {
      continue;
    }

    const [, field, minimum, maximum] = entry;
    transform[field] = Math.max(minimum, Math.min(maximum, numeric));
  }

  return transform;
}
