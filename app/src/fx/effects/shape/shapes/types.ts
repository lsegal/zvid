// One shape the Shape effect can mask a layer to. Shapes are drawn over the
// layer's whole box, in box coordinates: `x` and `y` run 0..1 from the box's
// top-left corner to its bottom-right one.
export type ShapeDefinition = {
  // Stored as the Shape parameter's value.
  name: string;
  // GLSL body of `float f(vec2 p)`, with `p` in box coordinates: below 0
  // inside the shape, above 0 outside it and 0 on its edge. The pass
  // antialiases the edge by the function's gradient in pixels, so it only
  // has to be smooth near 0, not a true distance.
  glsl: string;
  // The same function in TypeScript, for tests and anything drawn off the
  // GPU.
  distance(x: number, y: number): number;
  // SVG path of the shape in a 100 by 100 box, for the picker's previews.
  previewPath: string;
};

// A number as a GLSL float literal, which needs a decimal point.
export function glslFloat(value: number) {
  return value.toFixed(6);
}
