import { DIAMOND, irisGlsl, renderIris } from "../shapes.ts";
import type { TransitionTypeDefinition } from "../type.ts";

// As Iris, with a diamond: a square standing on one corner.
export const transitionType: TransitionTypeDefinition = {
  name: "Diamond",
  menuOrder: 120,
  options: ["iris", "softness"],
  glsl: irisGlsl(DIAMOND),
  render: (input, uv, p) => renderIris(DIAMOND, input, uv, p),
};
