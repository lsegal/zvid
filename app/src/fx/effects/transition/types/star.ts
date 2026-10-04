import { STAR, irisGlsl, renderIris } from "../shapes.ts";
import type { TransitionTypeDefinition } from "../type.ts";

// As Iris, with a five-pointed star, one point up.
export const transitionType: TransitionTypeDefinition = {
  name: "Star",
  menuOrder: 130,
  options: ["iris", "softness"],
  glsl: irisGlsl(STAR),
  render: (input, uv, p) => renderIris(STAR, input, uv, p),
};
