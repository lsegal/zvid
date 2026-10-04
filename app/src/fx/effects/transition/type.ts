// What a Transition type is: one file in types/, which the generated
// types/index.generated.ts collects, so a new type adds a file and edits
// nothing else.

export type Rgba = readonly [number, number, number, number];
export type Vec2 = readonly [number, number];

// The settings a type may use besides its progress: the Direction it moves
// in, the Softness of its edge, whether an iris opens out of the center or
// closes into it, the Orientation of its bands, how many it has (Count),
// and the Origin it spreads from.
export type TransitionOption =
  | "direction"
  | "softness"
  | "iris"
  | "orientation"
  | "count"
  | "origin";

// What a type's `render` reads: the two comps, both premultiplied and
// transparent outside 0..1, and the settings. `direction` is the unit
// vector things move along, in picture coordinates (+y up). `irisIn` is
// true when an iris closes into the center rather than opening out of it,
// `vertical` when bands run up and down rather than across, `count` how
// many bands or squares there are, and `origin` the point things spread
// from, in picture coordinates.
export type TransitionInput = {
  a(uv: Vec2): Rgba;
  b(uv: Vec2): Rgba;
  direction: Vec2;
  softness: number;
  irisIn: boolean;
  vertical: boolean;
  count: number;
  origin: Vec2;
  resolution: Vec2;
};

export type TransitionTypeDefinition = {
  // Stored as the Type parameter's value.
  name: string;
  // Places the type in the Type menu, lowest first.
  menuOrder: number;
  // The settings it uses, which the device shows only for it.
  options?: readonly TransitionOption[];
  // GLSL body of `vec4 transitionColor(vec2 uv, float p)`: the picture at
  // `uv` (0..1, +y up), `p` of the way from comp A (0) to comp B (1). It
  // can call `compA(uv)` and `compB(uv)`, which are premultiplied and
  // transparent outside 0..1, `over(top, bottom)`, `transitionAlong(uv)`
  // (0 at the side things move from, 1 at the side they move to) and
  // `transitionNoise(uv)` (0..1, per pixel), and read `uDirection`,
  // `uSoftness`, `uIrisIn` (1 for In, else 0), `uVertical` (1 for
  // Vertical, else 0), `uCount`, `uOrigin` and `uResolution`.
  glsl: string;
  // The same function in TypeScript, for tests and anything drawn off the
  // GPU.
  render(input: TransitionInput, uv: Vec2, p: number): Rgba;
};

export const TRANSPARENT: Rgba = [0, 0, 0, 0];
export const BLACK: Rgba = [0, 0, 0, 1];

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function mixRgba(from: Rgba, to: Rgba, amount: number): Rgba {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
    from[3] + (to[3] - from[3]) * amount,
  ];
}

export function scaleRgba(color: Rgba, amount: number): Rgba {
  return [
    color[0] * amount,
    color[1] * amount,
    color[2] * amount,
    color[3] * amount,
  ];
}

// `top` drawn over `bottom`, premultiplied, as GLSL `over`.
export function over(top: Rgba, bottom: Rgba): Rgba {
  const rest = 1 - top[3];
  return [
    top[0] + bottom[0] * rest,
    top[1] + bottom[1] * rest,
    top[2] + bottom[2] * rest,
    top[3] + bottom[3] * rest,
  ];
}

// Where a picture drawn `amount` along `direction` is sampled at `uv`.
export function shifted(uv: Vec2, direction: Vec2, amount: number): Vec2 {
  return [uv[0] - direction[0] * amount, uv[1] - direction[1] * amount];
}

// Where a picture drawn at `scale` about the center is sampled at `uv`.
export function scaled(uv: Vec2, scale: number): Vec2 {
  const safe = Math.max(scale, 1e-4);
  return [0.5 + (uv[0] - 0.5) / safe, 0.5 + (uv[1] - 0.5) / safe];
}

// As GLSL `transitionAlong`.
export function along(uv: Vec2, direction: Vec2) {
  return (uv[0] - 0.5) * direction[0] + (uv[1] - 0.5) * direction[1] + 0.5;
}

function fract(value: number) {
  return value - Math.floor(value);
}

// As GLSL `transitionNoise`: a hash of the pixel `uv` falls in.
export function noise(uv: Vec2, resolution: Vec2) {
  const x = Math.floor(uv[0] * resolution[0]);
  const y = Math.floor(uv[1] * resolution[1]);
  return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
}
