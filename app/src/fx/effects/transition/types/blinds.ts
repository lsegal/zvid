import { MIN_EDGE, SWEEP_GLSL, sweep } from "../shapes.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// The widest edge, at Softness 100%: half a slat.
const MAX_EDGE = 0.5;

// Venetian blinds: the picture is cut into Count slats, across
// (Horizontal) or up and down (Vertical), and B closes over each one at
// once, from its top or its left edge.
export const transitionType: TransitionTypeDefinition = {
  name: "Blinds",
  menuOrder: 150,
  options: ["orientation", "count", "softness"],
  glsl: `
    float slats = max(floor(uCount + 0.5), 1.0);
    float t = uVertical > 0.5 ? fract(uv.x * slats) : 1.0 - fract(uv.y * slats);
    float width = max(uSoftness * ${MAX_EDGE.toFixed(6)}, ${MIN_EDGE.toFixed(6)});
    return mix(compA(uv), compB(uv), ${SWEEP_GLSL});
  `,
  render({ a, b, vertical, count, softness }, uv, p) {
    const slats = Math.max(Math.round(count), 1);
    const across = vertical ? uv[0] * slats : uv[1] * slats;
    const within = across - Math.floor(across);
    const t = vertical ? within : 1 - within;
    const width = Math.max(softness * MAX_EDGE, MIN_EDGE);
    return mixRgba(a(uv), b(uv), sweep(t, p, width));
  },
};
