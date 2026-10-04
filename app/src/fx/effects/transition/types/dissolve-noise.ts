import { noise, type TransitionTypeDefinition } from "../type.ts";

// Each pixel switches from A to B at its own random moment.
export const transitionType: TransitionTypeDefinition = {
  name: "Dissolve (Noise)",
  menuOrder: 30,
  glsl: `
    return transitionNoise(uv) < p ? compB(uv) : compA(uv);
  `,
  render({ a, b, resolution }, uv, p) {
    return noise(uv, resolution) < p ? b(uv) : a(uv);
  },
};
