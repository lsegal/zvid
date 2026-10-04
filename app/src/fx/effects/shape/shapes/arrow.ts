import { glslFloat, type ShapeDefinition } from "./types.ts";

// A block arrow pointing right: a shaft 40% of the box's height across, and
// a head from 60% of the way across to the tip at the middle of the right
// edge. Centered coordinates run -1..1, so the head starts at 0.2.
const SHAFT_HALF_HEIGHT = 0.4;
const HEAD_START = 0.2;
// The shaft runs a little into the head, so they join without a seam.
const SHAFT_END = HEAD_START + 0.1;
// The head's slanted edges' outward normal (below the middle), normalized.
const SLANT_X = 1 / Math.hypot(1, 0.8);
const SLANT_Y = 0.8 / Math.hypot(1, 0.8);

export const arrow: ShapeDefinition = {
  name: "Arrow",
  glsl: `
    vec2 q = p * 2.0 - 1.0;
    float shaft = max(max(-1.0 - q.x, q.x - ${glslFloat(SHAFT_END)}), abs(q.y) - ${glslFloat(SHAFT_HALF_HEIGHT)});
    float head = max(${glslFloat(HEAD_START)} - q.x, dot(vec2(q.x - 1.0, abs(q.y)), vec2(${glslFloat(SLANT_X)}, ${glslFloat(SLANT_Y)})));
    return min(shaft, head);
  `,
  distance(x, y) {
    const qx = x * 2 - 1;
    const qy = y * 2 - 1;
    const shaft = Math.max(
      -1 - qx,
      qx - SHAFT_END,
      Math.abs(qy) - SHAFT_HALF_HEIGHT,
    );
    const head = Math.max(
      HEAD_START - qx,
      (qx - 1) * SLANT_X + Math.abs(qy) * SLANT_Y,
    );
    return Math.min(shaft, head);
  },
  previewPath: "M0 30H60V0L100 50L60 100V70H0Z",
};
