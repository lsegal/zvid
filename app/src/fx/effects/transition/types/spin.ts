import { aspectOf, spun } from "../distort.ts";
import { over, scaleRgba, type TransitionTypeDefinition } from "../type.ts";

// A turns half a turn as it shrinks away and fades, while B turns in from
// half a turn the other way as it grows to fill the picture.
export const transitionType: TransitionTypeDefinition = {
  name: "Spin",
  menuOrder: 360,
  glsl: `
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 q = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float outAngle = p * 3.14159265;
    float inAngle = (p - 1.0) * 3.14159265;
    vec2 outQ = vec2(q.x * cos(outAngle) + q.y * sin(outAngle), -q.x * sin(outAngle) + q.y * cos(outAngle)) / max(1.0 - p, 0.0001);
    vec2 inQ = vec2(q.x * cos(inAngle) + q.y * sin(inAngle), -q.x * sin(inAngle) + q.y * cos(inAngle)) / max(p, 0.0001);
    vec4 outgoing = compA(vec2(outQ.x / aspect + 0.5, outQ.y + 0.5));
    vec4 incoming = compB(vec2(inQ.x / aspect + 0.5, inQ.y + 0.5));
    return over(outgoing * (1.0 - p), incoming * p);
  `,
  render({ a, b, resolution }, uv, p) {
    const aspect = aspectOf(resolution);
    return over(
      scaleRgba(a(spun(uv, p * Math.PI, 1 - p, aspect)), 1 - p),
      scaleRgba(b(spun(uv, (p - 1) * Math.PI, p, aspect)), p),
    );
  },
};
