// The Move effect's fixed motion curves: Linear and the CSS standard
// cubic-bézier eases. They map clip progress (0..1) onto eased progress
// (0..1) and have no controls.

export const MOTION_CURVES = [
  "Linear",
  "Ease In",
  "Ease Out",
  "Ease In Out",
] as const;

export type MotionCurve = (typeof MOTION_CURVES)[number];

export const DEFAULT_MOTION_CURVE: MotionCurve = "Ease In Out";

// Control points (x1, y1, x2, y2) of each curve's cubic bézier, as in CSS
// `cubic-bezier()`. The end points are always (0, 0) and (1, 1).
const BEZIERS: Record<Exclude<MotionCurve, "Linear">, readonly number[]> = {
  "Ease In": [0.42, 0, 1, 1],
  "Ease Out": [0, 0, 0.58, 1],
  "Ease In Out": [0.42, 0, 0.58, 1],
};

// One coordinate of a cubic bézier from 0 to 1 through `p1` and `p2`.
function bezierAxis(p1: number, p2: number, t: number) {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierAxisSlope(p1: number, p2: number, t: number) {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

// The eased value of a CSS cubic bézier at `x`: finds the curve parameter
// whose x is `x` (Newton's method, falling back to bisection where the slope
// is flat), then returns its y.
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
) {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }

  let t = x;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = bezierAxis(x1, x2, t) - x;
    if (Math.abs(error) < 1e-7) {
      return bezierAxis(y1, y2, t);
    }
    const slope = bezierAxisSlope(x1, x2, t);
    if (Math.abs(slope) < 1e-6) {
      break;
    }
    t -= error / slope;
  }

  // x(t) rises monotonically from 0 to 1 for control points in 0..1.
  let low = 0;
  let high = 1;
  t = x;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const value = bezierAxis(x1, x2, t);
    if (Math.abs(value - x) < 1e-7) {
      break;
    }
    if (value < x) {
      low = t;
    } else {
      high = t;
    }
    t = (low + high) / 2;
  }
  return bezierAxis(y1, y2, t);
}

// Reads a stored Motion value case-insensitively, ignoring spaces, hyphens
// and underscores; anything else is the default curve.
export function parseMotionCurve(value: string | undefined): MotionCurve {
  const normalized = value?.toLowerCase().replace(/[^a-z]/g, "");
  return (
    MOTION_CURVES.find(
      (curve) => curve.toLowerCase().replace(/[^a-z]/g, "") === normalized,
    ) ?? DEFAULT_MOTION_CURVE
  );
}

// Eased progress for clip progress `progress`, clamped to 0..1.
export function easeMotion(curve: MotionCurve, progress: number) {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  if (curve === "Linear") {
    return p;
  }
  const [x1, y1, x2, y2] = BEZIERS[curve];
  return cubicBezier(x1, y1, x2, y2, p);
}
