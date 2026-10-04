import {
  aspectOf,
  centered,
  clampUv,
  smoothstep,
  uncentered,
} from "../distort.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// How far the ripples push the picture at their strongest.
const AMPLITUDE = 0.03;
// How tightly the rings are packed, and how fast they travel out.
const FREQUENCY = 60;
const SPEED = 30;

// Rings ripple out from the center as if through water, strongest at the
// switch, while A fades into B.
export const transitionType: TransitionTypeDefinition = {
  name: "Ripple",
  menuOrder: 340,
  glsl: `
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 q = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float r = length(q);
    vec2 outward = r > 0.0001 ? q / r : vec2(0.0);
    float push = ${AMPLITUDE.toFixed(6)} * sin(3.14159265 * p) * sin(r * ${FREQUENCY.toFixed(1)} - p * ${SPEED.toFixed(1)});
    vec2 moved = q + outward * push;
    vec2 at = clamp(vec2(moved.x / aspect + 0.5, moved.y + 0.5), 0.0, 1.0);
    return mix(compA(at), compB(at), smoothstep(0.3, 0.7, p));
  `,
  render({ a, b, resolution }, uv, p) {
    const aspect = aspectOf(resolution);
    const [x, y] = centered(uv, aspect);
    const r = Math.hypot(x, y);
    const push =
      AMPLITUDE * Math.sin(Math.PI * p) * Math.sin(r * FREQUENCY - p * SPEED);
    const scale = r > 1e-4 ? push / r : 0;
    const at = clampUv(uncentered([x + x * scale, y + y * scale], aspect));
    return mixRgba(a(at), b(at), smoothstep(0.3, 0.7, p));
  },
};
