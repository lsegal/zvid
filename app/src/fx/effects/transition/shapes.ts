// Shared math for the shape and mask types in types/: the iris shapes and
// the sweep of an edge across a coordinate. Each helper has a GLSL twin
// that the types splice into their `glsl` bodies, so the two stay in step.

import {
  mixRgba,
  type Rgba,
  type TransitionInput,
  type Vec2,
} from "./type.ts";

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// A hard edge still has this width, which smoothstep needs.
export const MIN_EDGE = 1e-4;

// How much of B shows where an edge sweeping from `t` = 0 to `t` = 1 has
// reached, `p` of the way, with an edge `width` wide in `t`: 0 ahead of it,
// 1 behind it. None of B shows at `p` = 0 and all of it at 1.
export function sweep(t: number, p: number, width: number) {
  const edge = p * (1 + width);
  return 1 - smoothstep(edge - width, edge, t);
}

// As `sweep`, for GLSL: an expression with `t`, `p` and `width` in scope.
export const SWEEP_GLSL = `(1.0 - smoothstep(p * (1.0 + width) - width, p * (1.0 + width), t))`;

// `uv` measured from the center in units of the picture's short side, so
// shapes drawn in it keep their proportions in any aspect.
export function centered(uv: Vec2, resolution: Vec2): Vec2 {
  const short = Math.min(resolution[0], resolution[1]);
  return [
    ((uv[0] - 0.5) * resolution[0]) / short,
    ((uv[1] - 0.5) * resolution[1]) / short,
  ];
}

// Half the picture in the same units: where its top-right corner is.
export function halfExtent(resolution: Vec2): Vec2 {
  const short = Math.min(resolution[0], resolution[1]);
  return [(0.5 * resolution[0]) / short, (0.5 * resolution[1]) / short];
}

export const CENTERED_GLSL = `(uv - 0.5) * uResolution / min(uResolution.x, uResolution.y)`;
export const HALF_EXTENT_GLSL = `0.5 * uResolution / min(uResolution.x, uResolution.y)`;

// An iris shape: `gauge` is how many times bigger the shape must be to reach
// `q` (centered, as from `centered`), so its outline at size `s` is where
// the gauge is `s`. The shape at size 1 reaches at least `minRadius` from
// the center in every direction, which bounds how big it must grow to cover
// the picture. `gaugeGlsl` sets `float g` from `vec2 q` the same way.
export type IrisShape = {
  gauge(q: Vec2): number;
  gaugeGlsl: string;
  minRadius: number;
};

// The widest iris edge, at Softness 100%, in short sides.
const IRIS_MAX_EDGE = 0.5;

// B shows inside the shape growing from the center (Iris Out), or A shows
// inside the shape shrinking into it (Iris In).
export function renderIris(
  shape: IrisShape,
  { a, b, softness, irisIn, resolution }: TransitionInput,
  uv: Vec2,
  p: number,
): Rgba {
  const width = Math.max(softness * IRIS_MAX_EDGE, MIN_EDGE);
  const half = halfExtent(resolution);
  const reach = Math.hypot(half[0], half[1]) / shape.minRadius + width;
  const size = (irisIn ? 1 - p : p) * reach;
  const inside = 1 - smoothstep(size - width, size, shape.gauge(centered(uv, resolution)));
  return irisIn
    ? mixRgba(b(uv), a(uv), inside)
    : mixRgba(a(uv), b(uv), inside);
}

export function irisGlsl(shape: IrisShape) {
  return `
    vec2 q = ${CENTERED_GLSL};
    float g = 0.0;
    ${shape.gaugeGlsl}
    float width = max(uSoftness * ${IRIS_MAX_EDGE.toFixed(6)}, ${MIN_EDGE.toFixed(6)});
    float reach = length(${HALF_EXTENT_GLSL}) / ${shape.minRadius.toFixed(6)} + width;
    float size = (uIrisIn > 0.5 ? 1.0 - p : p) * reach;
    float inside = 1.0 - smoothstep(size - width, size, g);
    return uIrisIn > 0.5
      ? mix(compB(uv), compA(uv), inside)
      : mix(compA(uv), compB(uv), inside);
  `;
}

// Below this distance from the center a point is the center, where angles
// are undefined.
const CENTER = 1e-6;

export const CIRCLE: IrisShape = {
  gauge: (q) => Math.hypot(q[0], q[1]),
  gaugeGlsl: "g = length(q);",
  minRadius: 1,
};

export const BOX: IrisShape = {
  gauge: (q) => Math.max(Math.abs(q[0]), Math.abs(q[1])),
  gaugeGlsl: "g = max(abs(q.x), abs(q.y));",
  minRadius: 1,
};

export const DIAMOND: IrisShape = {
  gauge: (q) => Math.abs(q[0]) + Math.abs(q[1]),
  gaugeGlsl: "g = abs(q.x) + abs(q.y);",
  minRadius: Math.SQRT1_2,
};

// A five-pointed star, one point up, its inner corners this far from the
// center as a fraction of its points.
const STAR_POINTS = 5;
const STAR_INNER = 0.45;
const STAR_SECTOR = (2 * Math.PI) / STAR_POINTS;
// The edge from a point (1, 0) to the inner corner after it, in the frame
// where the point is at angle 0: its outward unit normal and its distance
// from the center.
const STAR_HALF = STAR_SECTOR / 2;
const STAR_NORMAL: Vec2 = (() => {
  const x = STAR_INNER * Math.sin(STAR_HALF);
  const y = 1 - STAR_INNER * Math.cos(STAR_HALF);
  const length = Math.hypot(x, y);
  return [x / length, y / length];
})();
const STAR_EDGE_DISTANCE = STAR_NORMAL[0];

function starAngle(angle: number) {
  const offset = angle + STAR_HALF;
  return Math.abs(offset - STAR_SECTOR * Math.floor(offset / STAR_SECTOR) - STAR_HALF);
}

export const STAR: IrisShape = {
  gauge(q) {
    const radius = Math.hypot(q[0], q[1]);
    if (radius < CENTER) {
      return 0;
    }
    const angle = starAngle(Math.atan2(q[0], q[1]));
    return (
      (radius *
        (STAR_NORMAL[0] * Math.cos(angle) + STAR_NORMAL[1] * Math.sin(angle))) /
      STAR_EDGE_DISTANCE
    );
  },
  gaugeGlsl: `
    float radius = length(q);
    if (radius > ${CENTER.toFixed(6)}) {
      float offset = atan(q.x, q.y) + ${STAR_HALF.toFixed(6)};
      float angle = abs(mod(offset, ${STAR_SECTOR.toFixed(6)}) - ${STAR_HALF.toFixed(6)});
      g = radius * (${STAR_NORMAL[0].toFixed(6)} * cos(angle) + ${STAR_NORMAL[1].toFixed(6)} * sin(angle)) / ${STAR_EDGE_DISTANCE.toFixed(6)};
    }
  `,
  minRadius: STAR_INNER,
};

// The heart (x² + y² - 1)³ = x²y³, lobes up. Every ray from the center
// crosses its outline once, between these radii, so the outline's radius
// along a ray is found by halving the interval HEART_STEPS times.
const HEART_MIN_RADIUS = 0.78;
const HEART_MAX_RADIUS = 1.5;
const HEART_STEPS = 16;

function insideHeart(x: number, y: number) {
  const k = x * x + y * y - 1;
  return k * k * k - x * x * y * y * y <= 0;
}

export const HEART: IrisShape = {
  gauge(q) {
    const radius = Math.hypot(q[0], q[1]);
    if (radius < CENTER) {
      return 0;
    }
    const ux = q[0] / radius;
    const uy = q[1] / radius;
    let low = 0;
    let high = HEART_MAX_RADIUS;
    for (let step = 0; step < HEART_STEPS; step++) {
      const middle = (low + high) / 2;
      if (insideHeart(middle * ux, middle * uy)) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return radius / Math.max(low, MIN_EDGE);
  },
  gaugeGlsl: `
    float radius = length(q);
    if (radius > ${CENTER.toFixed(6)}) {
      vec2 ray = q / radius;
      float low = 0.0;
      float high = ${HEART_MAX_RADIUS.toFixed(6)};
      for (int i = 0; i < ${HEART_STEPS}; i++) {
        float middle = 0.5 * (low + high);
        vec2 pos = middle * ray;
        float k = dot(pos, pos) - 1.0;
        if (k * k * k - pos.x * pos.x * pos.y * pos.y * pos.y <= 0.0) {
          low = middle;
        } else {
          high = middle;
        }
      }
      g = radius / max(low, ${MIN_EDGE.toFixed(6)});
    }
  `,
  minRadius: HEART_MIN_RADIUS,
};
