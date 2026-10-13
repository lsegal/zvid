import { glslFloat } from "./types.ts";

// How far along a shape's edge a point lies, so an outline can be dashed and
// drawn on. The edge is measured in pixels of a `width` by `height` box,
// clockwise from its start at the top, so dashes keep their length however
// the box is stretched.
export type ShapeOutline = {
  // GLSL body of `vec2 f(vec2 p, vec2 size)`, with `p` in box coordinates
  // and `size` the box in pixels: the distance along the edge to the point
  // on it nearest `p`, and the edge's whole length.
  glsl: string;
  // The same function in TypeScript.
  along(x: number, y: number, width: number, height: number): [number, number];
};

// Shared by every polygon's outline: measures `pixel` against the edge from
// `a` to `b`, keeping the distance along the outline of the nearest edge in
// `along.y` and its gap in `along.x`; `length` sums the edges so far.
export const OUTLINE_GLSL = `
  void outlineEdge(vec2 pixel, vec2 a, vec2 b, inout vec2 along, inout float length_) {
    vec2 edge = b - a;
    float edgeLength = length(edge);
    float h = clamp(dot(pixel - a, edge) / max(edgeLength * edgeLength, 1e-6), 0.0, 1.0);
    float gap = length(pixel - a - edge * h);
    if (gap < along.x) {
      along = vec2(gap, length_ + h * edgeLength);
    }
    length_ += edgeLength;
  }
`;

// The outline through `points`, in box coordinates, closed back to the
// first one.
export function polygonOutline(
  points: readonly (readonly [number, number])[],
): ShapeOutline {
  const edges = points.map((point, index) => [
    point,
    points[(index + 1) % points.length],
  ]);
  const vec = ([x, y]: readonly [number, number]) =>
    `vec2(${glslFloat(x)}, ${glslFloat(y)}) * size`;
  return {
    glsl: `
      vec2 pixel = p * size;
      vec2 along = vec2(1e20, 0.0);
      float length_ = 0.0;
      ${edges.map(([a, b]) => `outlineEdge(pixel, ${vec(a)}, ${vec(b)}, along, length_);`).join("\n      ")}
      return vec2(along.y, length_);
    `,
    along(x, y, width, height) {
      let nearest = Number.POSITIVE_INFINITY;
      let along = 0;
      let length = 0;
      for (const [a, b] of edges) {
        const ax = a[0] * width;
        const ay = a[1] * height;
        const ex = b[0] * width - ax;
        const ey = b[1] * height - ay;
        const edgeLength = Math.hypot(ex, ey);
        const h = Math.max(
          0,
          Math.min(
            1,
            ((x * width - ax) * ex + (y * height - ay) * ey) /
              Math.max(edgeLength * edgeLength, 1e-6),
          ),
        );
        const gap = Math.hypot(
          x * width - ax - ex * h,
          y * height - ay - ey * h,
        );
        if (gap < nearest) {
          nearest = gap;
          along = length + h * edgeLength;
        }
        length += edgeLength;
      }
      return [along, length];
    },
  };
}

// Steps of the ellipse's arc length integral; the integrand is smooth and
// periodic, so a few dozen give it to well under a pixel.
const ELLIPSE_STEPS = 48;

// The arc length of the ellipse with semi-axes `a` across and `b` down, from
// its top clockwise to parametric angle `angle`.
function ellipseArc(a: number, b: number, angle: number) {
  const step = angle / ELLIPSE_STEPS;
  let length = 0;
  for (let index = 0; index < ELLIPSE_STEPS; index += 1) {
    const t = (index + 0.5) * step;
    length += Math.hypot(a * Math.cos(t), b * Math.sin(t)) * step;
  }
  return length;
}

// The outline of the ellipse inscribed in the box. A point is placed on it
// by its parametric angle from the top, which is exact on a circle and
// close to the nearest point near any ellipse's edge.
export const ellipseOutline: ShapeOutline = {
  glsl: `
    vec2 q = p * 2.0 - 1.0;
    vec2 axes = size * 0.5;
    float angle = atan(q.x, -q.y);
    if (angle < 0.0) angle += ${glslFloat(2 * Math.PI)};
    float along = 0.0;
    float length_ = 0.0;
    for (int index = 0; index < ${ELLIPSE_STEPS}; index++) {
      float u = (float(index) + 0.5) / ${glslFloat(ELLIPSE_STEPS)};
      along += length(axes * vec2(cos(u * angle), sin(u * angle))) * angle;
      float t = u * ${glslFloat(2 * Math.PI)};
      length_ += length(axes * vec2(cos(t), sin(t))) * ${glslFloat(2 * Math.PI)};
    }
    return vec2(along, length_) / ${glslFloat(ELLIPSE_STEPS)};
  `,
  along(x, y, width, height) {
    let angle = Math.atan2(x * 2 - 1, 1 - y * 2);
    if (angle < 0) {
      angle += 2 * Math.PI;
    }
    const a = width / 2;
    const b = height / 2;
    return [ellipseArc(a, b, angle), ellipseArc(a, b, 2 * Math.PI)];
  },
};
