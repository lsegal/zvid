import {
  clamp01,
  over,
  shifted,
  type TransitionTypeDefinition,
} from "../type.ts";

// A slides out in the Direction and B follows behind it, a third of the
// way later, so a gap opens between them on the way.
export const transitionType: TransitionTypeDefinition = {
  name: "Swipe",
  menuOrder: 40,
  options: ["direction"],
  glsl: `
    float leading = clamp(p * 1.5, 0.0, 1.0);
    float trailing = clamp(p * 1.5 - 0.5, 0.0, 1.0);
    return over(
      compA(uv - uDirection * leading),
      compB(uv - uDirection * (trailing - 1.0))
    );
  `,
  render({ a, b, direction }, uv, p) {
    const leading = clamp01(p * 1.5);
    const trailing = clamp01(p * 1.5 - 0.5);
    return over(
      a(shifted(uv, direction, leading)),
      b(shifted(uv, direction, trailing - 1)),
    );
  },
};
