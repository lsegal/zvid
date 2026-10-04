import { rectangle } from "./rectangle.ts";
import type { ShapeDefinition } from "./types.ts";

export const CUSTOM_SHAPE_NAME = "Custom";

// A Custom shape is stored as `Custom:<path>`, naming the SVG media its mask
// comes from by path, like clips name theirs, so one pick is one value.
const CUSTOM_PREFIX = `${CUSTOM_SHAPE_NAME}:`;

export function customShapeValue(mediaPath: string) {
  return `${CUSTOM_PREFIX}${mediaPath}`;
}

// The media path a stored Shape value names, if it is a Custom one with a
// path.
export function customShapeMediaPath(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (trimmed.slice(0, CUSTOM_PREFIX.length).toLowerCase() !== "custom:") {
    return undefined;
  }
  return trimmed.slice(CUSTOM_PREFIX.length).trim() || undefined;
}

// The opaque area of an imported SVG, stretched over the box. The pass draws
// it from a mask texture instead of a function; until the mask is ready, or
// when its media is offline, the shape is the whole box.
export const custom: ShapeDefinition = {
  name: CUSTOM_SHAPE_NAME,
  glsl: rectangle.glsl,
  distance: rectangle.distance,
  previewPath: rectangle.previewPath,
};
