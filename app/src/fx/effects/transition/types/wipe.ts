import {
  along,
  mixRgba,
  type TransitionTypeDefinition,
} from "../type.ts";

// The widest edge, at Softness 100%: half the picture.
const MAX_EDGE = 0.5;
// A hard edge still has this width, which smoothstep needs.
const MIN_EDGE = 1e-4;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// An edge sweeps across in the Direction with B behind it, hard at
// Softness 0 and blended over up to half the picture at 100%.
export const transitionType: TransitionTypeDefinition = {
  name: "Wipe",
  menuOrder: 80,
  options: ["direction", "softness"],
  glsl: `
    float width = max(uSoftness * ${MAX_EDGE.toFixed(6)}, ${MIN_EDGE.toFixed(6)});
    float edge = p * (1.0 + width);
    float behind = 1.0 - smoothstep(edge - width, edge, transitionAlong(uv));
    return mix(compA(uv), compB(uv), behind);
  `,
  render({ a, b, direction, softness }, uv, p) {
    const width = Math.max(softness * MAX_EDGE, MIN_EDGE);
    const edge = p * (1 + width);
    const behind = 1 - smoothstep(edge - width, edge, along(uv, direction));
    return mixRgba(a(uv), b(uv), behind);
  },
};
