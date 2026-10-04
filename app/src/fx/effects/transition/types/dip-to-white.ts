import { mixRgba, type Rgba, type TransitionTypeDefinition } from "../type.ts";

const WHITE: Rgba = [1, 1, 1, 1];

// A flashes up to white, then B fades down out of it.
export const transitionType: TransitionTypeDefinition = {
  name: "Dip to White",
  menuOrder: 400,
  glsl: `
    vec4 white = vec4(1.0);
    if (p < 0.5) return mix(compA(uv), white, p * 2.0);
    return mix(white, compB(uv), p * 2.0 - 1.0);
  `,
  render({ a, b }, uv, p) {
    return p < 0.5
      ? mixRgba(a(uv), WHITE, p * 2)
      : mixRgba(WHITE, b(uv), p * 2 - 1);
  },
};
