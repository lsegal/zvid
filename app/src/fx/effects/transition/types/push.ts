import { over, shifted, type TransitionTypeDefinition } from "../type.ts";

// B slides in from behind and pushes A off in the Direction, edge to edge.
export const transitionType: TransitionTypeDefinition = {
  name: "Push",
  menuOrder: 50,
  options: ["direction"],
  glsl: `
    return over(compA(uv - uDirection * p), compB(uv - uDirection * (p - 1.0)));
  `,
  render({ a, b, direction }, uv, p) {
    return over(a(shifted(uv, direction, p)), b(shifted(uv, direction, p - 1)));
  },
};
