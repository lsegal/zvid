import { over, shifted, type TransitionTypeDefinition } from "../type.ts";

// B slides in the Direction over A, which stays still.
export const transitionType: TransitionTypeDefinition = {
  name: "Cover",
  menuOrder: 70,
  options: ["direction"],
  glsl: `
    return over(compB(uv - uDirection * (p - 1.0)), compA(uv));
  `,
  render({ a, b, direction }, uv, p) {
    return over(b(shifted(uv, direction, p - 1)), a(uv));
  },
};
