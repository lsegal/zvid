import { customShapeMediaPath } from "./shapes/custom.ts";

// The Shape effect's name and parameter, shared by its definition, pass and
// the add path that gives a shaped layer its default Transform.
export const SHAPE_EFFECT_NAME = "Shape";
export const SHAPE_KEY = "Shape";

// The outline's parameters. A Stroke of 0 fills the shape; above 0 the shape
// is drawn as an outline that wide inside its edge, dashed when Dash is above
// 0. Lengths are in output pixels at 1080p, as the shape is shown.
export const STROKE_KEY = "StrokeWidth";
export const DASH_KEY = "DashLength";
export const GAP_KEY = "DashGap";
export const OFFSET_KEY = "DashOffset";
// How much of the outline is drawn, from its start at the top clockwise.
export const DRAWN_KEY = "StrokeDrawn";

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

// The SVG media paths of the enabled Custom shapes among `effects`, such as
// a session's, without repeats.
export function customShapeMediaPaths(
  effects: readonly {
    effectName: string;
    enabled?: boolean;
    parameters: readonly { key: string; value: string }[];
  }[],
) {
  const paths = new Set<string>();
  for (const effect of effects) {
    if (effect.enabled === false || !isShapeEffectName(effect.effectName)) {
      continue;
    }
    const value = effect.parameters.find(
      (parameter) => parameter.key.toLowerCase() === SHAPE_KEY.toLowerCase(),
    )?.value;
    const path = customShapeMediaPath(value);
    if (path) {
      paths.add(path);
    }
  }
  return Array.from(paths);
}
