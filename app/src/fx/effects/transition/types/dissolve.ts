import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// A crossfade: B shows through A more and more.
export const transitionType: TransitionTypeDefinition = {
  name: "Dissolve",
  menuOrder: 20,
  glsl: `
    return mix(compA(uv), compB(uv), p);
  `,
  render({ a, b }, uv, p) {
    return mixRgba(a(uv), b(uv), p);
  },
};
