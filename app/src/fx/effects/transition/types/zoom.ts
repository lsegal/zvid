import {
  over,
  scaled,
  scaleRgba,
  type TransitionTypeDefinition,
} from "../type.ts";

// A zooms out to half its size as it fades, while B zooms in from half its
// size to fill the picture as it fades up.
export const transitionType: TransitionTypeDefinition = {
  name: "Zoom",
  menuOrder: 90,
  glsl: `
    vec2 center = vec2(0.5);
    vec4 outgoing = compA(center + (uv - center) / max(1.0 - p * 0.5, 0.0001));
    vec4 incoming = compB(center + (uv - center) / max(0.5 + p * 0.5, 0.0001));
    return over(outgoing * (1.0 - p), incoming * p);
  `,
  render({ a, b }, uv, p) {
    return over(
      scaleRgba(a(scaled(uv, 1 - p * 0.5)), 1 - p),
      scaleRgba(b(scaled(uv, 0.5 + p * 0.5)), p),
    );
  },
};
