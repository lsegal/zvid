// The Shape effect's name and parameter, shared by its definition, pass and
// the add path that gives a shaped layer its default Transform.
export const SHAPE_EFFECT_NAME = "Shape";
export const SHAPE_KEY = "Shape";

export function isShapeEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "shape";
}

// A new Shape's layer is a square centered in the canvas, its side this
// fraction of the canvas height.
export const DEFAULT_SHAPE_SIZE = 0.5;

// The Transform scale that makes a layer filling a `width` by `height`
// canvas a centered square DEFAULT_SHAPE_SIZE of its height across.
export function defaultShapeScale(width: number, height: number) {
  const aspect = width > 0 && height > 0 ? height / width : 1;
  return { scaleX: DEFAULT_SHAPE_SIZE * aspect, scaleY: DEFAULT_SHAPE_SIZE };
}
