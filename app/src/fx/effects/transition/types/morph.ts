import { clampUv, luminance } from "../distort.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// How far a pixel's luminance moves the other picture, at most.
const STRENGTH = 0.1;

// A crossfade in which each picture warps along the other's light and dark:
// A is pushed by B's luminance more as B arrives, and B by A's less as A
// leaves.
export const transitionType: TransitionTypeDefinition = {
  name: "Morph",
  menuOrder: 370,
  glsl: `
    vec3 weights = vec3(0.2126, 0.7152, 0.0722);
    float lumA = dot(compA(uv).rgb, weights);
    float lumB = dot(compB(uv).rgb, weights);
    vec4 outgoing = compA(clamp(uv + vec2((lumB - 0.5) * ${STRENGTH.toFixed(6)} * p), 0.0, 1.0));
    vec4 incoming = compB(clamp(uv - vec2((lumA - 0.5) * ${STRENGTH.toFixed(6)} * (1.0 - p)), 0.0, 1.0));
    return mix(outgoing, incoming, p);
  `,
  render({ a, b }, uv, p) {
    const pushA = (luminance(b(uv)) - 0.5) * STRENGTH * p;
    const pushB = (luminance(a(uv)) - 0.5) * STRENGTH * (1 - p);
    return mixRgba(
      a(clampUv([uv[0] + pushA, uv[1] + pushA])),
      b(clampUv([uv[0] - pushB, uv[1] - pushB])),
      p,
    );
  },
};
