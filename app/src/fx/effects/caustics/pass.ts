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
  return params.find(
    (candidate) => normalizeEffectKey(candidate.key) === target,
  )?.value;
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
  const color = parseCssColor(value) ?? parseCssColor(DEFAULT_CAUSTICS_COLOR);
  if (!color) {
    return [1, 1, 1];
  }
  return [color.r, color.g, color.b].map(
    (channel) => (channel / 255) * color.a,
  );
}

// Where the pattern is in its loop, 0..2π. Every term of the field moves at
// a whole multiple of this phase, so it loops seamlessly, and wrapping it
// here in double precision keeps the shader's sines precise at mediump.
// Speed 0 holds it at 0, freezing the pattern.
export function causticsPhase(time: number, speed: number) {
  const phase = (time * speed * MAX_RATE) % TAU;
  return phase < 0 ? phase + TAU : phase;
}

// Underwater light caustics. The field is the bright edges between the
// cells of two layers of moving Voronoi points, bent by sines. It is laid
// out in image space with square cells (`uRes` gives the aspect), flipped by
// `uDown` so it stands the same way on top-down and bottom-up textures. `_Scale` sets the cell size, `_Speed`
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

    vec2 hash2(vec2 c) {
      return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453);
    }

    // F2 - F1 of one point per cell, each circling its cell a whole number
    // of times, one to three either way, per turn of the phase, and its
    // gradient: the nearest two points' distances change along their
    // directions from p.
    vec3 edges(vec2 p, float t) {
      vec2 id = floor(p);
      vec2 f = fract(p);
      float d1 = 8.0;
      float d2 = 8.0;
      vec2 v1 = vec2(0.0);
      vec2 v2 = vec2(0.0);
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 o = vec2(float(x), float(y));
          vec2 h = hash2(id + o);
          float turns = (floor(h.x * 3.0) + 1.0) * sign(h.y - 0.5);
          float a = turns * t + 6.2831853 * h.y;
          vec2 v = o + 0.5 + 0.35 * vec2(cos(a), sin(a)) - f;
          float d = length(v);
          if (d < d1) {
            d2 = d1;
            v2 = v1;
            d1 = d;
            v1 = v;
          } else if (d < d2) {
            d2 = d;
            v2 = v;
          }
        }
      }
      return vec3(d2 - d1, v1 / max(d1, 1e-4) - v2 / max(d2, 1e-4));
    }

    // Bright ridges along the cell edges of two drifting layers, their
    // edges bent by sines so they curve like light through waves, and the
    // ridges' gradient, worked out in the same evaluation rather than by
    // evaluating the field twice more beside each pixel.
    vec3 caustic(vec2 p) {
      float t = uPhase;
      vec2 wave = vec2(p.y * 1.3 + t, p.x * 1.7 - t);
      vec2 q = p + 0.12 * sin(wave);
      vec3 a = edges(q, t);
      vec3 b = edges(q * 1.6 + vec2(3.1, 7.7), -t);
      float ra = max(1.0 - a.x * 3.0, 0.0);
      float rb = max(1.0 - b.x * 3.0, 0.0);
      float value = ra * ra * ra * ra + 0.6 * rb * rb * rb * rb;
      if (value >= 1.0) return vec3(1.0, 0.0, 0.0);
      vec2 slope = -12.0 * (ra * ra * ra * a.yz + 0.96 * rb * rb * rb * b.yz);
      vec2 bend = vec2(0.156, 0.204) * cos(wave);
      return vec3(value, slope.x + slope.y * bend.y, slope.y + slope.x * bend.x);
    }

    void main() {
      float aspect = uRes.x / max(uRes.y, 1.0);
      float cells = mix(10.0, 1.5, uScale);
      vec2 image = vec2(vUv.x * aspect, 0.5 + (vUv.y - 0.5) * uDown);
      vec3 field = caustic(image * cells);
      float f = field.x;
      vec2 grad = field.yz;
      vec2 offset = grad * uWarp * 0.0015;
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
