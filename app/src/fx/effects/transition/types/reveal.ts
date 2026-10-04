import { over, shifted, type TransitionTypeDefinition } from "../type.ts";

// A slides away in the Direction and uncovers B, which stays still.
export const transitionType: TransitionTypeDefinition = {
  name: "Reveal",
  menuOrder: 60,
  options: ["direction"],
  glsl: `
    return over(compA(uv - uDirection * p), compB(uv));
  `,
  render({ a, b, direction }, uv, p) {
    return over(a(shifted(uv, direction, p)), b(uv));
  },
};
