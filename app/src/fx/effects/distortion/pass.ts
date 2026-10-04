import {
  clampUnit,
  type EffectParameter,
  type EffectPass,
  normalizeEffectKey,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";
import { DISTORTION_EDGES, DISTORTION_TYPES } from "./definition.ts";

// The index of the option `key` holds, matched case-insensitively, or 0 for
// a missing or unknown value.
export function readOptionIndex(
  params: EffectParameter[],
  key: string,
  options: readonly string[],
) {
  const target = normalizeEffectKey(key);
  const value = params
    .find((candidate) => normalizeEffectKey(candidate.key) === target)
    ?.value?.trim()
    .toLowerCase();
  return Math.max(
    0,
    options.findIndex((option) => option.toLowerCase() === value),
  );
}

// Displaces where each pixel samples the layer. Distances are in picture
// heights, so circles stay round on any aspect. `_Size` is the wavelength of
// Wave, Ripple and Turbulence and the radius of Twirl, Bulge and Fisheye.
// Every type scales its offset by `_Amount`, so 0 leaves the picture as is.
// `_Speed` advances the phase with the playhead time, which wraps here in
// full precision, so scrubbing to a time always gives the same frame. The
// math runs top-down (`uFlip` turns a bottom-up texture over), so Angle and
// Center mean the same on layer textures and framebuffers.
export const pass: EffectPass = {
  effectName: "Distortion",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec2 uRes, uDir, uCenter;
    uniform float uType, uEdges, uAmount, uSize, uPhase, uFlip;
    varying vec2 vUv;

    const float TAU = 6.2831853;

    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(h(i), h(i + vec2(1.0, 0.0)), f.x),
        mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    void main() {
      vec2 scale = vec2(uRes.x / max(uRes.y, 1.0), 1.0);
      vec2 img = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlip));
      vec2 p = img * scale;
      vec2 d = p - uCenter * scale;
      float r = length(d);
      float size = mix(0.02, 1.0, uSize);
      float amp = 0.05 * uAmount;
      vec2 offset = vec2(0.0);

      if (uType < 0.5) {
        // Wave: sine offsets across the direction of travel.
        offset = vec2(-uDir.y, uDir.x) * amp * sin(dot(p, uDir) * TAU / size + uPhase);
      } else if (uType < 1.5) {
        // Ripple: rings moving out from the center, faded in over the
        // first quarter wave so the center doesn't pinch to a point.
        vec2 away = r > 0.0 ? d / r : vec2(0.0);
        float fade = min(1.0, r * 4.0 / size);
        offset = away * amp * fade * sin(r * TAU / size - uPhase);
      } else if (uType < 2.5) {
        // Twirl: rotation that falls off to nothing at the radius.
        float fall = max(0.0, 1.0 - r / size);
        float a = uAmount * 3.1415927 * fall * fall;
        float s = sin(a);
        float c = cos(a);
        offset = vec2(c * d.x - s * d.y, s * d.x + c * d.y) - d;
      } else if (uType < 3.5) {
        // Bulge, or Pinch below 0: a power remap of the radius.
        float n = r / size;
        if (n < 1.0) {
          offset = d * (pow(max(n, 0.0001), pow(2.0, uAmount) - 1.0) - 1.0);
        }
      } else if (uType < 4.5) {
        // Fisheye: barrel, or pincushion below 0, inside the radius.
        float n = r / size;
        if (n < 1.0) {
          offset = -d * 0.75 * uAmount * (1.0 - n * n);
        }
      } else {
        // Turbulence: two octaves of value noise, circling through the
        // noise as the phase turns so the motion loops seamlessly.
        vec2 q = p / size + vec2(cos(uPhase), sin(uPhase)) * 1.5;
        vec2 n = vec2(
          noise(q) + 0.5 * noise(q * 2.0 + 19.1),
          noise(q + vec2(7.3, 3.1)) + 0.5 * noise(q * 2.0 + 41.7)
        );
        offset = (n / 1.5 - 0.5) * 2.0 * amp;
      }

      vec2 uv = img + offset / scale;
      if (uEdges < 0.5) {
        uv = clamp(uv, 0.0, 1.0);
      } else if (uEdges < 1.5) {
        uv = 1.0 - abs(1.0 - mod(uv, 2.0));
      }
      vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
      vec4 color = texture2D(uTex, vec2(uv.x, mix(uv.y, 1.0 - uv.y, uFlip)));
      gl_FragColor = uEdges > 1.5 ? color * inside.x * inside.y : color;
    }
  `,
  uniforms: [
    "uRes",
    "uDir",
    "uCenter",
    "uType",
    "uEdges",
    "uAmount",
    "uSize",
    "uPhase",
    "uFlip",
  ],
  setUniforms(gl, loc, params, ctx) {
    const speed = clampUnit(readEffectNumber(params, "_Speed", 0));
    // Up to two cycles a second.
    const cycles = ctx.time * speed * 2;
    const angle =
      (clampUnit(readEffectNumber(params, "_Angle", 0), 0, 360) * Math.PI) /
      180;
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    // Counterclockwise on screen, where y runs down.
    gl.uniform2f(loc.uDir, Math.cos(angle), -Math.sin(angle));
    gl.uniform2f(
      loc.uCenter,
      clampUnit(readEffectNumber(params, "_CenterX", 0.5)),
      clampUnit(readEffectNumber(params, "_CenterY", 0.5)),
    );
    gl.uniform1f(loc.uType, readOptionIndex(params, "_Type", DISTORTION_TYPES));
    gl.uniform1f(
      loc.uEdges,
      readOptionIndex(params, "_Edges", DISTORTION_EDGES),
    );
    gl.uniform1f(
      loc.uAmount,
      clampUnit(readEffectNumber(params, "_Amount", 0.3), -1, 1),
    );
    gl.uniform1f(loc.uSize, clampUnit(readEffectNumber(params, "_Size", 0.5)));
    gl.uniform1f(loc.uPhase, (cycles - Math.floor(cycles)) * 2 * Math.PI);
    gl.uniform1f(loc.uFlip, ctx.bottomUp ? 1 : 0);
  },
  // Amount 0 moves nothing, whatever the type and edges.
  isIdentity(params) {
    return clampUnit(readEffectNumber(params, "_Amount", 0.3), -1, 1) === 0;
  },
};
