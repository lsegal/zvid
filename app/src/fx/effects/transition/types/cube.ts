import { faceHit, faceHitGlsl } from "../distort.ts";
import {
  scaleRgba,
  TRANSPARENT,
  type TransitionTypeDefinition,
} from "../type.ts";

// A and B on two faces of a cube that turns a quarter turn, A rolling off
// in the Direction as B rolls in behind it. Each face darkens as it turns
// away.
export const transitionType: TransitionTypeDefinition = {
  name: "Cube",
  menuOrder: 310,
  options: ["direction"],
  glsl: `
    float angle = p * 1.57079633;
    float cosAngle = cos(angle);
    float sinAngle = sin(angle);
    ${faceHitGlsl("front", "vec2(0.5 * sinAngle, 0.5 - 0.5 * cosAngle)", "vec2(cosAngle, sinAngle)")}
    ${faceHitGlsl("side", "vec2(-0.5 * cosAngle, 0.5 - 0.5 * sinAngle)", "vec2(sinAngle, -cosAngle)")}
    if (frontHit && (!sideHit || frontDepth <= sideDepth)) {
      return compA(frontUv) * (0.6 + 0.4 * cosAngle);
    }
    if (sideHit) return compB(sideUv) * (0.6 + 0.4 * sinAngle);
    return vec4(0.0);
  `,
  render({ a, b, direction }, uv, p) {
    const angle = (p * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const front = faceHit(uv, direction, {
      center: [0.5 * sin, 0.5 - 0.5 * cos],
      tangent: [cos, sin],
    });
    const side = faceHit(uv, direction, {
      center: [-0.5 * cos, 0.5 - 0.5 * sin],
      tangent: [sin, -cos],
    });
    if (front && (!side || front.depth <= side.depth)) {
      return scaleRgba(a(front.uv), 0.6 + 0.4 * cos);
    }
    if (side) {
      return scaleRgba(b(side.uv), 0.6 + 0.4 * sin);
    }
    return TRANSPARENT;
  },
};
