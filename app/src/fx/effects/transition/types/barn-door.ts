import { MIN_EDGE, SWEEP_GLSL, sweep } from "../shapes.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// The widest edge, at Softness 100%: half of each door.
const MAX_EDGE = 0.5;

// A splits down the middle and its two doors swing open onto B, out to the
// sides (Horizontal) or to the top and bottom (Vertical).
export const transitionType: TransitionTypeDefinition = {
  name: "Barn Door",
  menuOrder: 160,
  options: ["orientation", "softness"],
  glsl: `
    float t = 2.0 * abs((uVertical > 0.5 ? uv.y : uv.x) - 0.5);
    float width = max(uSoftness * ${MAX_EDGE.toFixed(6)}, ${MIN_EDGE.toFixed(6)});
    return mix(compA(uv), compB(uv), ${SWEEP_GLSL});
  `,
  render({ a, b, vertical, softness }, uv, p) {
    const t = 2 * Math.abs((vertical ? uv[1] : uv[0]) - 0.5);
    const width = Math.max(softness * MAX_EDGE, MIN_EDGE);
    return mixRgba(a(uv), b(uv), sweep(t, p, width));
  },
};
