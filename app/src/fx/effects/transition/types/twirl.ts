import {
  aspectOf,
  centered,
  peak,
  smoothstep,
  uncentered,
} from "../distort.ts";
import { mixRgba, type TransitionTypeDefinition } from "../type.ts";

// How many turns the center makes at the switch.
const TURNS = 2;

// A swirls into a vortex about the center, which unwinds into B. The
// center turns furthest, the corners not at all.
export const transitionType: TransitionTypeDefinition = {
  name: "Twirl",
  menuOrder: 330,
  glsl: `
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 q = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float falloff = max(0.0, 1.0 - length(q) / length(vec2(0.5 * aspect, 0.5)));
    float angle = (1.0 - abs(2.0 * p - 1.0)) * ${(TURNS * 2 * Math.PI).toFixed(6)} * falloff * falloff;
    vec2 turned = vec2(q.x * cos(angle) + q.y * sin(angle), -q.x * sin(angle) + q.y * cos(angle));
    vec2 at = vec2(turned.x / aspect + 0.5, turned.y + 0.5);
    return mix(compA(at), compB(at), smoothstep(0.4, 0.6, p));
  `,
  render({ a, b, resolution }, uv, p) {
    const aspect = aspectOf(resolution);
    const [x, y] = centered(uv, aspect);
    const falloff = Math.max(
      0,
      1 - Math.hypot(x, y) / Math.hypot(0.5 * aspect, 0.5),
    );
    const angle = peak(p) * TURNS * 2 * Math.PI * falloff * falloff;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const at = uncentered([x * cos + y * sin, -x * sin + y * cos], aspect);
    return mixRgba(a(at), b(at), smoothstep(0.4, 0.6, p));
  },
};
