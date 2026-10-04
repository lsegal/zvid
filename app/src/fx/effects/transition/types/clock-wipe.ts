import {
  CENTERED_GLSL,
  centered,
  MIN_EDGE,
  SWEEP_GLSL,
  sweep,
} from "../shapes.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// The widest edge, at Softness 100%: a quarter turn.
const MAX_EDGE = 0.25;

// A hand sweeps clockwise around the center from twelve o'clock with B
// behind it.
export const transitionType: TransitionTypeDefinition = {
  name: "Clock Wipe",
  menuOrder: 170,
  options: ["softness"],
  glsl: `
    vec2 q = ${CENTERED_GLSL};
    float t = length(q) > 0.000001 ? fract(atan(q.x, q.y) / 6.283185) : 0.0;
    float width = max(uSoftness * ${MAX_EDGE.toFixed(6)}, ${MIN_EDGE.toFixed(6)});
    return mix(compA(uv), compB(uv), ${SWEEP_GLSL});
  `,
  render({ a, b, softness, resolution }, uv, p) {
    const q = centered(uv, resolution);
    const turn = Math.atan2(q[0], q[1]) / (2 * Math.PI);
    const t = Math.hypot(q[0], q[1]) > 1e-6 ? turn - Math.floor(turn) : 0;
    const width = Math.max(softness * MAX_EDGE, MIN_EDGE);
    return mixRgba(a(uv), b(uv), sweep(t, p, width));
  },
};
