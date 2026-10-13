import { polygonOutline } from "./outline.ts";
import { glslFloat, type ShapeDefinition } from "./types.ts";

// A five-pointed star, point up, stretched so its points touch every edge
// of the box. In star coordinates (y up) the outer points lie on the unit
// circle and the inner corners at INNER_RADIUS; the star spans
// ±sin(72°) across and from -cos(36°) to 1 up.
const INNER_RADIUS = 0.382;
const HALF_WIDTH = Math.sin((72 * Math.PI) / 180);
const BOTTOM = Math.cos((36 * Math.PI) / 180);
const K1X = Math.cos((36 * Math.PI) / 180);
const K1Y = -Math.sin((36 * Math.PI) / 180);

// Box coordinates (0..1, y down) to star coordinates (y up).
function toStar(x: number, y: number): [number, number] {
  return [(x * 2 - 1) * HALF_WIDTH, 1 - y * (1 + BOTTOM)];
}

// Inigo Quilez's signed distance to a five-pointed star.
function starDistance(px: number, py: number) {
  let x = Math.abs(px);
  let y = py;
  let d = 2 * Math.max(K1X * x + K1Y * y, 0);
  x -= d * K1X;
  y -= d * K1Y;
  d = 2 * Math.max(-K1X * x + K1Y * y, 0);
  x -= d * -K1X;
  y -= d * K1Y;
  x = Math.abs(x);
  y -= 1;
  const bax = INNER_RADIUS * -K1Y;
  const bay = INNER_RADIUS * K1X - 1;
  const h = Math.max(
    0,
    Math.min(1, (x * bax + y * bay) / (bax * bax + bay * bay)),
  );
  return Math.hypot(x - bax * h, y - bay * h) * Math.sign(y * bax - x * bay);
}

// The star's points and inner corners in box coordinates, clockwise from
// its top point.
function corners() {
  const points: [number, number][] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 ? INNER_RADIUS : 1;
    const angle = Math.PI / 2 - (index * Math.PI) / 5;
    const sx = radius * Math.cos(angle);
    const sy = radius * Math.sin(angle);
    points.push([(sx / HALF_WIDTH + 1) / 2, (1 - sy) / (1 + BOTTOM)]);
  }
  return points;
}

function previewPath() {
  const points = corners().map(
    ([x, y], index) =>
      `${index ? "L" : "M"}${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`,
  );
  return `${points.join("")}Z`;
}

export const star: ShapeDefinition = {
  name: "Star",
  glsl: `
    vec2 s = vec2((p.x * 2.0 - 1.0) * ${glslFloat(HALF_WIDTH)}, 1.0 - p.y * ${glslFloat(1 + BOTTOM)});
    vec2 k1 = vec2(${glslFloat(K1X)}, ${glslFloat(K1Y)});
    vec2 k2 = vec2(-k1.x, k1.y);
    s.x = abs(s.x);
    s -= 2.0 * max(dot(k1, s), 0.0) * k1;
    s -= 2.0 * max(dot(k2, s), 0.0) * k2;
    s.x = abs(s.x);
    s.y -= 1.0;
    vec2 ba = ${glslFloat(INNER_RADIUS)} * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
    float h = clamp(dot(s, ba) / dot(ba, ba), 0.0, 1.0);
    return length(s - ba * h) * sign(s.y * ba.x - s.x * ba.y);
  `,
  distance(x, y) {
    return starDistance(...toStar(x, y));
  },
  outline: polygonOutline(corners()),
  previewPath: previewPath(),
};
