// The shapes the Shape effect offers, in the picker's order. A new shape
// adds its file here and nowhere else.
import { arrow } from "./arrow.ts";
import { oval } from "./oval.ts";
import { rectangle } from "./rectangle.ts";
import { star } from "./star.ts";
import type { ShapeDefinition } from "./types.ts";

export type { ShapeDefinition } from "./types.ts";

export const SHAPES: readonly ShapeDefinition[] = [rectangle, oval, star, arrow];

export const DEFAULT_SHAPE = rectangle;

// The shape named `name`, case-insensitively; the default for a name no
// shape has, such as one a newer build saved.
export function findShape(name: string | undefined) {
  const wanted = name?.trim().toLowerCase();
  return (
    SHAPES.find((shape) => shape.name.toLowerCase() === wanted) ??
    DEFAULT_SHAPE
  );
}

// Index of the shape `name` in SHAPES, as findShape resolves it.
export function shapeIndex(name: string | undefined) {
  return SHAPES.indexOf(findShape(name));
}
