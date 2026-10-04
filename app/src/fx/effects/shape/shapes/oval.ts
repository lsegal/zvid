import type { ShapeDefinition } from "./types.ts";

// The ellipse inscribed in the box.
export const oval: ShapeDefinition = {
  name: "Oval",
  glsl: `
    return length(p * 2.0 - 1.0) - 1.0;
  `,
  distance(x, y) {
    return Math.hypot(x * 2 - 1, y * 2 - 1) - 1;
  },
  previewPath: "M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z",
};
