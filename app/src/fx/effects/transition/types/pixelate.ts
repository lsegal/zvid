import { peak, smoothstep } from "../distort.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// A breaks into ever larger blocks, up to an eighth of the picture's short
// edge at the switch, then B sharpens back out of them. Blocks double in
// size at an even pace, as the Pixelate effect's do.
export const transitionType: TransitionTypeDefinition = {
  name: "Pixelate",
  menuOrder: 380,
  glsl: `
    float block = max(1.0, pow(2.0, (1.0 - abs(2.0 * p - 1.0)) * log2(min(uResolution.x, uResolution.y) / 8.0)));
    vec2 cell = block / uResolution;
    vec2 at = (floor(uv / cell) + 0.5) * cell;
    return mix(compA(at), compB(at), smoothstep(0.45, 0.55, p));
  `,
  render({ a, b, resolution }, uv, p) {
    const block = Math.max(
      1,
      2 ** (peak(p) * Math.log2(Math.min(resolution[0], resolution[1]) / 8)),
    );
    const cellX = block / resolution[0];
    const cellY = block / resolution[1];
    const at = [
      (Math.floor(uv[0] / cellX) + 0.5) * cellX,
      (Math.floor(uv[1] / cellY) + 0.5) * cellY,
    ] as const;
    return mixRgba(a(at), b(at), smoothstep(0.45, 0.55, p));
  },
};
