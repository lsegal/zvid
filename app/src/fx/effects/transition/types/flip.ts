import { faceHit, faceHitGlsl } from "../distort.ts";
import {
  scaleRgba,
  TRANSPARENT,
  type TransitionTypeDefinition,
} from "../type.ts";

// A turns over in 3D to show B on its back: about the vertical axis for
// Left or Right (a horizontal flip), the horizontal one for Up or Down (a
// vertical flip), its edge on the Direction's side turning away first. Each
// side darkens as it turns edge-on.
export const transitionType: TransitionTypeDefinition = {
  name: "Flip",
  menuOrder: 300,
  options: ["direction"],
  glsl: `
    float angle = p < 0.5 ? p * 3.14159265 : (p - 1.0) * 3.14159265;
    ${faceHitGlsl("card", "vec2(0.0)", "vec2(cos(angle), sin(angle))")}
    if (!cardHit) return vec4(0.0);
    vec4 side = p < 0.5 ? compA(cardUv) : compB(cardUv);
    return side * (0.6 + 0.4 * abs(cos(angle)));
  `,
  render({ a, b, direction }, uv, p) {
    const angle = p < 0.5 ? p * Math.PI : (p - 1) * Math.PI;
    const hit = faceHit(uv, direction, {
      center: [0, 0],
      tangent: [Math.cos(angle), Math.sin(angle)],
    });
    if (!hit) {
      return TRANSPARENT;
    }
    const side = p < 0.5 ? a(hit.uv) : b(hit.uv);
    return scaleRgba(side, 0.6 + 0.4 * Math.abs(Math.cos(angle)));
  },
};
