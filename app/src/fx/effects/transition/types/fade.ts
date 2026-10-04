import { BLACK, mixRgba, type TransitionTypeDefinition } from "../type.ts";

// A fades to black, then B fades up from it.
export const transitionType: TransitionTypeDefinition = {
  name: "Fade",
  menuOrder: 10,
  glsl: `
    vec4 black = vec4(0.0, 0.0, 0.0, 1.0);
    if (p < 0.5) return mix(compA(uv), black, p * 2.0);
    return mix(black, compB(uv), p * 2.0 - 1.0);
  `,
  render({ a, b }, uv, p) {
    return p < 0.5
      ? mixRgba(a(uv), BLACK, p * 2)
      : mixRgba(BLACK, b(uv), p * 2 - 1);
  },
};
