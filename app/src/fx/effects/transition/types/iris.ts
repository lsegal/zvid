import { CIRCLE, irisGlsl, renderIris } from "../shapes.ts";
import type { TransitionTypeDefinition } from "../type.ts";

// A circle opens out of the center onto B (Out), or closes A into the
// center (In), its edge as soft as Softness.
export const transitionType: TransitionTypeDefinition = {
  name: "Iris",
  menuOrder: 100,
  options: ["iris", "softness"],
  glsl: irisGlsl(CIRCLE),
  render: (input, uv, p) => renderIris(CIRCLE, input, uv, p),
};
