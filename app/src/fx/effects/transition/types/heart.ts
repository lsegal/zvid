import { HEART, irisGlsl, renderIris } from "../shapes.ts";
import type { TransitionTypeDefinition } from "../type.ts";

// As Iris, with a heart.
export const transitionType: TransitionTypeDefinition = {
  name: "Heart",
  menuOrder: 140,
  options: ["iris", "softness"],
  glsl: irisGlsl(HEART),
  render: (input, uv, p) => renderIris(HEART, input, uv, p),
};
