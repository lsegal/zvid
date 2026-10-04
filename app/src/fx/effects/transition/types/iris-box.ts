import { BOX, irisGlsl, renderIris } from "../shapes.ts";
import type { TransitionTypeDefinition } from "../type.ts";

// As Iris, with a square.
export const transitionType: TransitionTypeDefinition = {
  name: "Iris (Box)",
  menuOrder: 110,
  options: ["iris", "softness"],
  glsl: irisGlsl(BOX),
  render: (input, uv, p) => renderIris(BOX, input, uv, p),
};
