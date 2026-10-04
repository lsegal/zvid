import { clampUv, hash, hashGlsl, peak } from "../distort.ts";
import type { TransitionTypeDefinition } from "../type.ts";

// How many bands the picture tears into, how often they jump, and how far
// they and the color channels slide apart at the switch.
const BANDS = 24;
const JUMPS = 12;
const TEAR = 0.25;
const SPLIT = 0.02;

// The picture tears into horizontal bands that jump sideways, its red and
// blue sliding apart, worst at the middle. Each band cuts from A to B at
// its own moment. What slides in from beyond the edge repeats the edge.
export const transitionType: TransitionTypeDefinition = {
  name: "Glitch",
  menuOrder: 390,
  glsl: `
    float strength = 1.0 - abs(2.0 * p - 1.0);
    float band = floor(uv.y * ${BANDS.toFixed(1)});
    float jump = floor(p * ${JUMPS.toFixed(1)});
    ${hashGlsl("tearHash", "band", "jump")}
    ${hashGlsl("cutHash", "band", "7.0")}
    float tear = (tearHash - 0.5) * ${TEAR.toFixed(6)} * strength;
    bool cut = cutHash < p;
    vec2 at = uv + vec2(tear, 0.0);
    vec2 split = vec2(${SPLIT.toFixed(6)} * strength, 0.0);
    vec4 red = cut ? compB(clamp(at + split, 0.0, 1.0)) : compA(clamp(at + split, 0.0, 1.0));
    vec4 middle = cut ? compB(clamp(at, 0.0, 1.0)) : compA(clamp(at, 0.0, 1.0));
    vec4 blue = cut ? compB(clamp(at - split, 0.0, 1.0)) : compA(clamp(at - split, 0.0, 1.0));
    return vec4(red.r, middle.g, blue.b, middle.a);
  `,
  render({ a, b }, uv, p) {
    const strength = peak(p);
    const band = Math.floor(uv[1] * BANDS);
    const jump = Math.floor(p * JUMPS);
    const tear = (hash(band, jump) - 0.5) * TEAR * strength;
    const comp = hash(band, 7) < p ? b : a;
    const split = SPLIT * strength;
    const x = uv[0] + tear;
    const middle = comp(clampUv([x, uv[1]]));
    return [
      comp(clampUv([x + split, uv[1]]))[0],
      middle[1],
      comp(clampUv([x - split, uv[1]]))[2],
      middle[3],
    ];
  },
};
