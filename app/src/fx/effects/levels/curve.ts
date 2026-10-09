// Levels' tone curves: a master curve and one for each of red, green and
// blue, each mapping an input level (0..1) to an output level through a
// smooth spline over its points.
//
// A `curve` parameter stores the four as text, master first, separated by
// `|`, each as its points `x,y` separated by spaces, such as
// `0,0 0.5,0.6 1,1|||`. A channel left empty, or the whole value empty, is
// the straight diagonal, which leaves the levels as they are.

export type CurvePoint = readonly [x: number, y: number];

export type CurveChannel = "master" | "red" | "green" | "blue";

export const CURVE_CHANNELS: readonly CurveChannel[] = [
  "master",
  "red",
  "green",
  "blue",
];

export type LevelsCurves = Readonly<
  Record<CurveChannel, readonly CurvePoint[]>
>;

export const IDENTITY_POINTS: readonly CurvePoint[] = [
  [0, 0],
  [1, 1],
];

export const IDENTITY_CURVES: LevelsCurves = {
  master: IDENTITY_POINTS,
  red: IDENTITY_POINTS,
  green: IDENTITY_POINTS,
  blue: IDENTITY_POINTS,
};

// Points closer than this on x are one point.
export const MIN_POINT_GAP = 0.01;

// The most points a channel keeps.
export const MAX_CURVE_POINTS = 16;

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

// `points` sorted by x, clamped to 0..1 and rounded as stored, with points
// closer than MIN_POINT_GAP merged, or the identity when fewer than two are
// left.
export function normalizePoints(
  points: readonly CurvePoint[],
): readonly CurvePoint[] {
  const sorted = points
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]): CurvePoint => [round(clampUnit(x)), round(clampUnit(y))])
    .sort((a, b) => a[0] - b[0]);
  const kept: CurvePoint[] = [];
  for (const point of sorted) {
    const last = kept[kept.length - 1];
    if (last && point[0] - last[0] < MIN_POINT_GAP) {
      continue;
    }
    kept.push(point);
  }
  return kept.length >= 2 ? kept.slice(0, MAX_CURVE_POINTS) : IDENTITY_POINTS;
}

function parseChannel(text: string | undefined) {
  if (!text?.trim()) {
    return IDENTITY_POINTS;
  }
  const points = text
    .trim()
    .split(/\s+/)
    .map((pair): CurvePoint => {
      const [x, y] = pair.split(",").map(Number);
      return [x, y];
    });
  return normalizePoints(points);
}

export function parseCurves(value: string | undefined): LevelsCurves {
  const channels = (value ?? "").split("|");
  return {
    master: parseChannel(channels[0]),
    red: parseChannel(channels[1]),
    green: parseChannel(channels[2]),
    blue: parseChannel(channels[3]),
  };
}

export function isIdentityPoints(points: readonly CurvePoint[]) {
  return points.every(([x, y]) => x === y);
}

export function isIdentityCurves(curves: LevelsCurves) {
  return CURVE_CHANNELS.every((channel) => isIdentityPoints(curves[channel]));
}

// The stored text for `curves`: empty for the identity, and an identity
// channel left empty.
export function formatCurves(curves: LevelsCurves) {
  if (isIdentityCurves(curves)) {
    return "";
  }
  return CURVE_CHANNELS.map((channel) => {
    const points = normalizePoints(curves[channel]);
    return isIdentityPoints(points)
      ? ""
      : points.map(([x, y]) => `${x},${y}`).join(" ");
  }).join("|");
}

// The slopes of a monotone cubic through `points` (Fritsch-Carlson), so the
// curve never overshoots between points that rise or fall steadily.
function monotoneSlopes(points: readonly CurvePoint[]) {
  const count = points.length;
  const secants: number[] = [];
  for (let index = 0; index < count - 1; index++) {
    const dx = points[index + 1][0] - points[index][0];
    secants.push(dx > 0 ? (points[index + 1][1] - points[index][1]) / dx : 0);
  }
  const slopes = points.map((_, index) => {
    if (index === 0) return secants[0];
    if (index === count - 1) return secants[count - 2];
    const before = secants[index - 1];
    const after = secants[index];
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  for (let index = 0; index < count - 1; index++) {
    const secant = secants[index];
    if (secant === 0) {
      slopes[index] = 0;
      slopes[index + 1] = 0;
      continue;
    }
    const a = slopes[index] / secant;
    const b = slopes[index + 1] / secant;
    const length = Math.hypot(a, b);
    if (length > 3) {
      slopes[index] = (3 * a * secant) / length;
      slopes[index + 1] = (3 * b * secant) / length;
    }
  }
  return slopes;
}

const slopeCache = new WeakMap<readonly CurvePoint[], number[]>();

// The curve through `points` at input `x`, held flat past its first and
// last points and clamped to 0..1.
export function evaluateCurve(points: readonly CurvePoint[], x: number) {
  const count = points.length;
  if (count < 2) {
    return clampUnit(x);
  }
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[count - 1][0]) return points[count - 1][1];
  let slopes = slopeCache.get(points);
  if (!slopes) {
    slopes = monotoneSlopes(points);
    slopeCache.set(points, slopes);
  }
  let index = 0;
  while (index < count - 2 && x > points[index + 1][0]) {
    index++;
  }
  const [x0, y0] = points[index];
  const [x1, y1] = points[index + 1];
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const value =
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * h * slopes[index] +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * h * slopes[index + 1];
  return clampUnit(value);
}

// Samples the shader's lookup table holds per channel, evenly from 0 to 1.
export const CURVE_LUT_SIZE = 33;

// Each channel's curve after the master one, sampled at CURVE_LUT_SIZE
// evenly spaced input levels, as interleaved red, green and blue.
export function curveLut(curves: LevelsCurves) {
  const lut = new Float32Array(CURVE_LUT_SIZE * 3);
  for (let index = 0; index < CURVE_LUT_SIZE; index++) {
    const master = evaluateCurve(curves.master, index / (CURVE_LUT_SIZE - 1));
    lut[index * 3] = evaluateCurve(curves.red, master);
    lut[index * 3 + 1] = evaluateCurve(curves.green, master);
    lut[index * 3 + 2] = evaluateCurve(curves.blue, master);
  }
  return lut;
}

// Reads `lut` at `level` as the shader does: linearly between samples.
export function sampleLut(lut: Float32Array, level: number, channel: number) {
  const position = clampUnit(level) * (CURVE_LUT_SIZE - 1);
  const index = Math.min(CURVE_LUT_SIZE - 2, Math.floor(position));
  const fraction = position - index;
  return (
    lut[index * 3 + channel] * (1 - fraction) +
    lut[(index + 1) * 3 + channel] * fraction
  );
}
