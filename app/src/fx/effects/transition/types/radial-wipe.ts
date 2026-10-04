import {
  CENTERED_GLSL,
  centered,
  HALF_EXTENT_GLSL,
  halfExtent,
  MIN_EDGE,
  SWEEP_GLSL,
  sweep,
} from "../shapes.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// The widest edge, at Softness 100%: half the way to the farthest corner.
const MAX_EDGE = 0.5;

// A circle of B spreads from the Origin, the center or a corner, until it
// reaches the farthest corner, with an edge as soft as Softness.
export const transitionType: TransitionTypeDefinition = {
  name: "Radial Wipe",
  menuOrder: 200,
  options: ["origin", "softness"],
  glsl: `
    vec2 q = ${CENTERED_GLSL};
    vec2 extent = ${HALF_EXTENT_GLSL};
    vec2 origin = (uOrigin - 0.5) * 2.0 * extent;
    float t = length(q - origin) / length(extent + abs(origin));
    float width = max(uSoftness * ${MAX_EDGE.toFixed(6)}, ${MIN_EDGE.toFixed(6)});
    return mix(compA(uv), compB(uv), ${SWEEP_GLSL});
  `,
  render({ a, b, origin, softness, resolution }, uv, p) {
    const q = centered(uv, resolution);
    const extent = halfExtent(resolution);
    const ox = (origin[0] - 0.5) * 2 * extent[0];
    const oy = (origin[1] - 0.5) * 2 * extent[1];
    const t =
      Math.hypot(q[0] - ox, q[1] - oy) /
      Math.hypot(extent[0] + Math.abs(ox), extent[1] + Math.abs(oy));
    const width = Math.max(softness * MAX_EDGE, MIN_EDGE);
    return mixRgba(a(uv), b(uv), sweep(t, p, width));
  },
};
