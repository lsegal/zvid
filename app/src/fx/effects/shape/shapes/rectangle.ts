import type { ShapeDefinition } from "./types.ts";

// The whole box.
export const rectangle: ShapeDefinition = {
  name: "Rectangle",
  glsl: `
    vec2 q = abs(p * 2.0 - 1.0);
    return max(q.x, q.y) - 1.0;
  `,
  distance(x, y) {
    return Math.max(Math.abs(x * 2 - 1), Math.abs(y * 2 - 1)) - 1;
  },
  previewPath: "M0 0H100V100H0Z",
};
