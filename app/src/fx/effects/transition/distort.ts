// What the 3D and distortion types in types/ share: TypeScript helpers for
// their `render`s, and GLSL snippets their shader bodies inline, since a
// body can't declare functions of its own.

import type { Rgba, Vec2 } from "./type.ts";

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Rec. 709 luminance of a premultiplied color, as GLSL
// `dot(color.rgb, vec3(0.2126, 0.7152, 0.0722))`.
export function luminance(color: Rgba) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

// 0..1, the same for the same `x` and `y`, as GLSL
// `fract(sin(x * 12.9898 + y * 78.233) * 43758.5453)`.
export function hash(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

// 0 at the start and end of a transition and 1 halfway, for effects that
// build up to the switch and die away after it.
export function peak(p: number) {
  return 1 - Math.abs(2 * p - 1);
}

// Width over height, so turns and circles stay round on any picture.
export function aspectOf(resolution: Vec2) {
  return resolution[0] / Math.max(resolution[1], 1);
}

// `uv` about the center in square units: x scaled by `aspect`.
export function centered(uv: Vec2, aspect: number): Vec2 {
  return [(uv[0] - 0.5) * aspect, uv[1] - 0.5];
}

// Back from `centered`.
export function uncentered(point: Vec2, aspect: number): Vec2 {
  return [point[0] / aspect + 0.5, point[1] + 0.5];
}

// Where a picture turned by `angle` (radians, counterclockwise) and drawn at
// `scale` about the center is sampled at `uv`.
export function spun(
  uv: Vec2,
  angle: number,
  scale: number,
  aspect: number,
): Vec2 {
  const [x, y] = centered(uv, aspect);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const safe = Math.max(scale, 1e-4);
  return uncentered(
    [(x * cos + y * sin) / safe, (-x * sin + y * cos) / safe],
    aspect,
  );
}

// How far the eye sits in front of the picture, in picture widths, for the
// types that turn it in 3D.
export const VIEW_DISTANCE = 2;

// A flat face, cut through the plane of the Direction axis and depth: its
// center, as (along the axis, depth into the picture), and the unit vector
// its picture's Direction axis runs along. A face at center [0, 0] with
// tangent [1, 0] is the picture itself.
export type Face = { center: Vec2; tangent: Vec2 };

// Where on `face` the eye sees through `uv`, as a picture coordinate, and
// how deep that point is; null where it misses the face. `direction` is the
// axis the face turns across.
export function faceHit(
  uv: Vec2,
  direction: Vec2,
  face: Face,
): { uv: Vec2; depth: number } | null {
  const rel: Vec2 = [uv[0] - 0.5, uv[1] - 0.5];
  const across: Vec2 = [-direction[1], direction[0]];
  const s = rel[0] * direction[0] + rel[1] * direction[1];
  const c = rel[0] * across[0] + rel[1] * across[1];
  const { center, tangent } = face;
  const denom = tangent[0] - (s * tangent[1]) / VIEW_DISTANCE;
  if (Math.abs(denom) < 1e-6) {
    return null;
  }
  const u =
    ((s * (center[1] + VIEW_DISTANCE)) / VIEW_DISTANCE - center[0]) / denom;
  const depth = center[1] + u * tangent[1];
  const v = (c * (depth + VIEW_DISTANCE)) / VIEW_DISTANCE;
  if (depth <= -VIEW_DISTANCE || Math.abs(u) > 0.5 || Math.abs(v) > 0.5) {
    return null;
  }
  return {
    uv: [
      0.5 + direction[0] * u + across[0] * v,
      0.5 + direction[1] * u + across[1] * v,
    ],
    depth,
  };
}

// GLSL for `faceHit`: declares `<name>Hit` (bool), `<name>Uv` and
// `<name>Depth` from the GLSL vec2 expressions `center` and `tangent`.
export function faceHitGlsl(name: string, center: string, tangent: string) {
  const d = VIEW_DISTANCE.toFixed(1);
  return `
    bool ${name}Hit = false;
    vec2 ${name}Uv = vec2(0.0);
    float ${name}Depth = 0.0;
    {
      vec2 faceCenter = ${center};
      vec2 faceTangent = ${tangent};
      vec2 across = vec2(-uDirection.y, uDirection.x);
      float s = dot(uv - 0.5, uDirection);
      float c = dot(uv - 0.5, across);
      float denom = faceTangent.x - s * faceTangent.y / ${d};
      if (abs(denom) >= 0.000001) {
        float u = (s * (faceCenter.y + ${d}) / ${d} - faceCenter.x) / denom;
        float depth = faceCenter.y + u * faceTangent.y;
        float v = c * (depth + ${d}) / ${d};
        if (depth > -${d} && abs(u) <= 0.5 && abs(v) <= 0.5) {
          ${name}Hit = true;
          ${name}Uv = 0.5 + uDirection * u + across * v;
          ${name}Depth = depth;
        }
      }
    }
  `;
}
