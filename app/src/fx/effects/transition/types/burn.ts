import { luminance, smoothstep } from "../distort.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// The widest burning edge, at Softness 100%, in luminance.
const MAX_EDGE = 0.5;
// A hard edge still has this width, which smoothstep needs.
const MIN_EDGE = 1e-4;
// How brightly the edge glows, and its color.
const GLOW = 0.9;
const EMBER = [1, 0.45, 0.1] as const;

// A burns away brightest first, B showing through the holes, along a
// glowing edge that Softness widens.
export const transitionType: TransitionTypeDefinition = {
  name: "Burn",
  menuOrder: 410,
  options: ["softness"],
  glsl: `
    vec4 outgoing = compA(uv);
    float edge = max(uSoftness * ${MAX_EDGE.toFixed(6)}, ${MIN_EDGE.toFixed(6)});
    float lower = 1.0 - p * (1.0 + edge);
    float burnt = smoothstep(lower, lower + edge, dot(outgoing.rgb, vec3(0.2126, 0.7152, 0.0722)));
    vec4 color = mix(outgoing, compB(uv), burnt);
    vec3 ember = vec3(${EMBER.map((value) => value.toFixed(6)).join(", ")});
    color.rgb = min(color.rgb + ember * ${GLOW.toFixed(6)} * 4.0 * burnt * (1.0 - burnt) * color.a, vec3(color.a));
    return color;
  `,
  render({ a, b, softness }, uv, p) {
    const outgoing = a(uv);
    const edge = Math.max(softness * MAX_EDGE, MIN_EDGE);
    const lower = 1 - p * (1 + edge);
    const burnt = smoothstep(lower, lower + edge, luminance(outgoing));
    const color = mixRgba(outgoing, b(uv), burnt);
    const glow = GLOW * 4 * burnt * (1 - burnt) * color[3];
    return [
      Math.min(color[0] + EMBER[0] * glow, color[3]),
      Math.min(color[1] + EMBER[1] * glow, color[3]),
      Math.min(color[2] + EMBER[2] * glow, color[3]),
      color[3],
    ];
  },
};
