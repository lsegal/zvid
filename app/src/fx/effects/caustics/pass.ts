import { parseCssColor } from "../../../fill-paint.ts";
import {
  clampUnit,
  type EffectParameter,
  type EffectPass,
  normalizeEffectKey,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

export const CAUSTICS_BLENDS = ["Add", "Screen", "Multiply"] as const;

// Light cyan.
export const DEFAULT_CAUSTICS_COLOR = "rgba(170,240,255,1)";

// The pattern's angular rate at Speed 100%, in radians per second.
const MAX_RATE = 4;
const TAU = 2 * Math.PI;

function readEffectValue(params: EffectParameter[], key: string) {
  const target = normalizeEffectKey(key);
  return params.find((candidate) => normalizeEffectKey(candidate.key) === target)
    ?.value;
}

// The Blend option's index in CAUSTICS_BLENDS, Screen when it is unknown.
export function causticsBlendIndex(value: string | undefined) {
  const index = CAUSTICS_BLENDS.findIndex(
    (blend) => blend.toLowerCase() === value?.trim().toLowerCase(),
  );
  return index < 0 ? 1 : index;
}

// The light's color, 0..1 per channel, scaled by its alpha.
export function causticsColor(value: string | undefined) {
  const color =
    parseCssColor(value) ?? parseCssColor(DEFAULT_CAUSTICS_COLOR);
  if (!color) {
    return [1, 1, 1];
  }
  return [color.r, color.g, color.b].map((channel) => (channel / 255) * color.a);
}

// Where the pattern is in its loop, 0..2π. Every term of the field moves at
// a whole multiple of this phase, so it loops seamlessly, and wrapping it
// here in double precision keeps the shader's sines precise at mediump.
// Speed 0 holds it at 0, freezing the pattern.
export function causticsPhase(time: number, speed: number) {
  const phase = (time * speed * MAX_RATE) % TAU;
  return phase < 0 ? phase + TAU : phase;
}

// Underwater light caustics. The field is the zero set of a sine pattern
// whose domain is warped by three octaves of moving sines, sharpened into
// bright ridges. It is laid out in image space with square cells (`uRes`
// gives the aspect), flipped by `uDown` so it stands the same way on
// top-down and bottom-up textures. `_Scale` sets the cell size, `_Speed`
// how fast `uPhase` turns, and `_Warp` how far the field's gradient bends
// the image under it. `_Intensity` blends `_Color` light over the layer by
// `_Blend`, keeping its alpha, so Intensity 0 with Warp 0 leaves it as it
// is. The music moves the knobs only through the Animation modifier's
// Reactive mode.
export const pass: EffectPass = {
  effectName: "Caustics",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform vec3 uColor;
    uniform float uPhase, uDown, uIntensity, uScale, uWarp, uBlend;
    varying vec2 vUv;

    float caustic(vec2 p) {
      float t = uPhase;
      vec2 q = p;
      q += vec2(sin(q.y * 0.9 + t), sin(q.x * 1.1 - t));
      q += 0.5 * vec2(sin(q.y * 1.7 - 2.0 * t + 1.3), sin(q.x * 1.5 + 2.0 * t + 0.7));
      q += 0.25 * vec2(sin(q.y * 2.3 + 3.0 * t + 2.1), sin(q.x * 2.9 - 3.0 * t + 4.2));
      float w = 0.5 * (sin(q.x) + sin(q.y));
      return pow(1.0 - abs(w), 8.0);
    }

    void main() {
      float aspect = uRes.x / max(uRes.y, 1.0);
      float cells = mix(12.0, 1.5, uScale);
      vec2 image = vec2(vUv.x * aspect, 0.5 + (vUv.y - 0.5) * uDown);
      vec2 p = image * cells * 6.2831853;
      float e = 0.05;
      float f = caustic(p);
      vec2 grad = vec2(caustic(p + vec2(e, 0.0)) - f, caustic(p + vec2(0.0, e)) - f) / e;
      vec2 offset = grad * uWarp * 0.004;
      vec4 c = texture2D(uTex, vUv + vec2(offset.x / aspect, offset.y * uDown));
      vec3 light = uColor * f;
      vec3 lit = uBlend < 0.5 ? c.rgb + light
        : uBlend < 1.5 ? 1.0 - (1.0 - c.rgb) * (1.0 - light)
        : c.rgb * light;
      gl_FragColor = vec4(clamp(mix(c.rgb, lit, uIntensity), 0.0, 1.0), c.a);
    }
  `,
  uniforms: [
    "uRes",
    "uColor",
    "uPhase",
    "uDown",
    "uIntensity",
    "uScale",
    "uWarp",
    "uBlend",
  ],
  setUniforms(gl, loc, params, ctx) {
    const speed = clampUnit(readEffectNumber(params, "_Speed", 0.3));
    const [r, g, b] = causticsColor(readEffectValue(params, "_Color"));
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    gl.uniform3f(loc.uColor, r, g, b);
    gl.uniform1f(loc.uPhase, causticsPhase(ctx.time, speed));
    gl.uniform1f(loc.uDown, ctx.bottomUp ? -1 : 1);
    gl.uniform1f(
      loc.uIntensity,
      clampUnit(readEffectNumber(params, "_Intensity", 0.5)),
    );
    gl.uniform1f(
      loc.uScale,
      clampUnit(readEffectNumber(params, "_Scale", 0.5)),
    );
    gl.uniform1f(loc.uWarp, clampUnit(readEffectNumber(params, "_Warp", 0.1)));
    gl.uniform1f(
      loc.uBlend,
      causticsBlendIndex(readEffectValue(params, "_Blend")),
    );
  },
};
