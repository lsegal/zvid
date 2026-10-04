import type { Rgba, TransitionTypeDefinition } from "../type.ts";

// How far toward the center the blur reaches at the cut, and how many
// samples it averages.
const REACH = 0.35;
const SAMPLES = 16;

// The picture blurs outward from the center, strongest at the cut from A
// to B halfway through.
export const transitionType: TransitionTypeDefinition = {
  name: "Zoom Blur",
  menuOrder: 350,
  glsl: `
    float reach = ${REACH.toFixed(6)} * sin(3.14159265 * p);
    vec4 sum = vec4(0.0);
    for (int i = 0; i < ${SAMPLES}; i++) {
      vec2 at = 0.5 + (uv - 0.5) * (1.0 - reach * float(i) / ${(SAMPLES - 1).toFixed(1)});
      sum += p < 0.5 ? compA(at) : compB(at);
    }
    return sum / ${SAMPLES.toFixed(1)};
  `,
  render({ a, b }, uv, p) {
    const reach = REACH * Math.sin(Math.PI * p);
    const comp = p < 0.5 ? a : b;
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < SAMPLES; i++) {
      const scale = 1 - (reach * i) / (SAMPLES - 1);
      const color = comp([
        0.5 + (uv[0] - 0.5) * scale,
        0.5 + (uv[1] - 0.5) * scale,
      ]);
      for (let channel = 0; channel < 4; channel++) {
        sum[channel] += color[channel];
      }
    }
    return sum.map((value) => value / SAMPLES) as unknown as Rgba;
  },
};
