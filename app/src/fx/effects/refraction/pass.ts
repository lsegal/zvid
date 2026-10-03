import {
  clampUnit,
  type EffectParameter,
  type EffectPass,
  normalizeEffectKey,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";
import { REFRACTION_TYPES } from "./definition.ts";

// Surface features per short side of the frame at Scale 0 and 100%.
const FINEST_FEATURES = 24;
const COARSEST_FEATURES = 3;

// How far apart Dispersion spreads the red and blue samples from green's,
// as a fraction of the refraction offset, at 100%.
const DISPERSION_SPREAD = 0.35;

// Water's four waves, in radians per second at Speed 100%.
const WAVE_RATES = [3.0, 1.9, 4.1, 5.3] as const;

// The Type's index in REFRACTION_TYPES, matched case-insensitively; Water
// for a missing or unknown value.
export function readRefractionType(params: EffectParameter[]) {
  const target = normalizeEffectKey("_Type");
  const value = params
    .find((candidate) => normalizeEffectKey(candidate.key) === target)
    ?.value?.trim()
    .toLowerCase();
  const index = REFRACTION_TYPES.findIndex(
    (type) => type.toLowerCase() === value,
  );
  return Math.max(0, index);
}

// Water's wave phases at `time`, wrapped to one turn here in double
// precision so the shader's mediump sines stay smooth however far into the
// timeline the playhead is.
export function wavePhases(time: number, speed: number) {
  return WAVE_RATES.map((rate) => (time * speed * rate) % (2 * Math.PI));
}

// Bends each sample's UV along a procedural surface normal: animated waves
// for Water, fine noise for Frosted Glass, a repeating cylindrical lens for
// Reeded Glass and a pillowed, beveled cell for Glass Blocks. The surface is
// laid out in square units of the frame's short side, top-down, so it looks
// the same on top-down layer textures and bottom-up framebuffers (`uDown`)
// and at any aspect. The offset is scaled by `uAmount`, so Amount 0 samples
// `vUv` exactly; `uChannel` scales it per channel for Dispersion and is 1
// for every channel at Dispersion 0. Water moves only through its wave
// phases, a function of the playhead time, so scrubbing to a time always
// gives the same frame. Alpha keeps the layer's own, so transparent areas
// stay clear.
export const pass: EffectPass = {
  effectName: "Refraction",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uType, uAmount, uFreq, uDown;
    uniform vec2 uAspect, uReed;
    uniform vec3 uChannel;
    uniform vec2 uWaveA, uWaveB;
    varying vec2 vUv;

    float hash(vec2 i) { return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453); }

    float noise(vec2 x) {
      vec2 i = floor(x);
      vec2 f = fract(x);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y);
    }

    float water(vec2 q) {
      float w = sin(dot(q, vec2(0.8, 0.6)) * 1.7 + uWaveA.x
        + 1.2 * sin(dot(q, vec2(-0.5, 0.87)) * 1.1 + uWaveA.y));
      w += 0.6 * sin(dot(q, vec2(0.26, -0.97)) * 2.3 + uWaveB.x);
      w += 0.4 * sin(dot(q, vec2(-0.9, -0.44)) * 3.1 - uWaveB.y);
      return w;
    }

    float frost(vec2 q) {
      return noise(q) + 0.5 * noise(q * 2.03 + 17.0);
    }

    // The surface's slope at q, in feature units, roughly -1..1.
    vec2 surface(vec2 q) {
      if (uType < 0.5) {
        vec2 e = vec2(0.05, 0.0);
        return 0.15 * vec2(water(q + e) - water(q - e), water(q + e.yx) - water(q - e.yx)) / (2.0 * e.x);
      }
      if (uType < 1.5) {
        vec2 f = q * 8.0;
        vec2 e = vec2(0.1, 0.0);
        return 0.5 * vec2(frost(f + e) - frost(f - e), frost(f + e.yx) - frost(f - e.yx)) / (2.0 * e.x);
      }
      if (uType < 2.5) {
        return -2.0 * (fract(dot(q, uReed)) - 0.5) * uReed;
      }
      vec2 c = fract(q) - 0.5;
      return -2.0 * c + 1.2 * sign(c) * smoothstep(0.35, 0.5, abs(c));
    }

    void main() {
      vec2 p = vec2(vUv.x, 0.5 + uDown * (vUv.y - 0.5)) * uAspect;
      vec2 o = surface(p * uFreq) * uAmount / (uFreq * uAspect);
      o.y *= uDown;
      vec4 base = texture2D(uTex, vUv);
      vec4 g = texture2D(uTex, clamp(vUv + o * uChannel.y, 0.0, 1.0));
      float r = texture2D(uTex, clamp(vUv + o * uChannel.x, 0.0, 1.0)).r;
      float b = texture2D(uTex, clamp(vUv + o * uChannel.z, 0.0, 1.0)).b;
      gl_FragColor = vec4(mix(base.rgb, vec3(r, g.g, b), g.a), base.a);
    }
  `,
  uniforms: [
    "uType",
    "uAmount",
    "uFreq",
    "uDown",
    "uAspect",
    "uReed",
    "uChannel",
    "uWaveA",
    "uWaveB",
  ],
  setUniforms(gl, loc, params, ctx) {
    const scale = clampUnit(readEffectNumber(params, "_Scale", 0.5));
    const speed = clampUnit(readEffectNumber(params, "_Speed", 0.2));
    const angle =
      (clampUnit(readEffectNumber(params, "_Angle", 90), 0, 180) * Math.PI) /
      180;
    const dispersion =
      DISPERSION_SPREAD * clampUnit(readEffectNumber(params, "_Dispersion", 0));
    const [width, height] = ctx.resolution;
    const short = Math.max(1, Math.min(width, height));
    gl.uniform1f(loc.uType, readRefractionType(params));
    gl.uniform1f(
      loc.uAmount,
      clampUnit(readEffectNumber(params, "_Amount", 0.3)),
    );
    gl.uniform1f(
      loc.uFreq,
      FINEST_FEATURES + (COARSEST_FEATURES - FINEST_FEATURES) * scale,
    );
    gl.uniform1f(loc.uDown, ctx.bottomUp ? -1 : 1);
    gl.uniform2f(
      loc.uAspect,
      Math.max(1, width) / short,
      Math.max(1, height) / short,
    );
    // Across the reeds, which run at `angle` counterclockwise from
    // horizontal in the top-down frame.
    gl.uniform2f(loc.uReed, Math.sin(angle), Math.cos(angle));
    gl.uniform3f(loc.uChannel, 1 - dispersion, 1, 1 + dispersion);
    const [a, b, c, d] = wavePhases(ctx.time, speed);
    gl.uniform2f(loc.uWaveA, a, b);
    gl.uniform2f(loc.uWaveB, c, d);
  },
};
