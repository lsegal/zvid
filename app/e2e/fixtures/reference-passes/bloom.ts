// The bloom pass as it was before #951 made it cheaper, kept as the visual
// reference e2e/effect-equivalence.spec.ts compares the current pass against.
import { parseCssColor } from "../../../src/fill-paint.ts";
import {
  clampUnit,
  type EffectParameter,
  type EffectPass,
  normalizeEffectKey,
  readEffectNumber,
} from "../../../src/fx-shaders/types.ts";

export const DEFAULT_BLOOM_TINT = "rgba(255,255,255,1)";

// Samples gathered around each pixel, on a golden-angle spiral.
export const BLOOM_SAMPLES = 48;

// The glow's reach at full Radius, as a fraction of the frame's shorter
// side.
export const BLOOM_MAX_RADIUS = 0.12;

// Width of the soft knee above Threshold, in luminance.
const KNEE = 0.1;

const WHITE = { r: 255, g: 255, b: 255, a: 1 };

function readTint(params: EffectParameter[]) {
  const target = normalizeEffectKey("_Tint");
  const value = params.find(
    (parameter) => normalizeEffectKey(parameter.key) === target,
  )?.value;
  return parseCssColor(value) ?? WHITE;
}

// Bright areas glow into their surroundings. Each pixel gathers samples on a
// golden-angle spiral out to `_Radius`, keeps only the light above
// `_Threshold` (eased in over a soft knee, so a pixel at or below it adds
// nothing), weights them by a Gaussian falloff, tints the sum by `_Tint` and
// adds it by `_Intensity`. The spiral is rotated by a hash of the pixel's
// position (interleaved gradient noise, which stays in range at mediump),
// trading banding for fine, static grain. Nothing depends on time, so
// preview and export match. The gather is symmetric, so it needs no
// bottom-up correction. Light is weighted by each sample's alpha and the
// glow raises alpha where it lands, so a bloomed logo glows over the layers
// beneath it. With no glow at a pixel it is passed through untouched.
export const referencePass: EffectPass = {
  effectName: "Bloom",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uThreshold, uIntensity, uRadius;
    uniform vec3 uTint;
    varying vec2 vUv;

    const int SAMPLES = ${BLOOM_SAMPLES};
    const float KNEE = ${KNEE.toFixed(2)};

    vec3 bright(vec4 c) {
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float over = l - uThreshold;
      if (over <= 0.0) return vec3(0.0);
      float q = min(over, KNEE);
      float soft = over < KNEE ? q * q / (2.0 * KNEE) : over - 0.5 * KNEE;
      float span = max(1.0 - uThreshold - 0.5 * KNEE, 0.05);
      return c.rgb * c.a * soft / (l * span);
    }

    void main() {
      vec4 c = texture2D(uTex, vUv);
      vec3 glow = bright(c);
      float total = 1.0;
      if (uIntensity > 0.0 && uRadius > 0.0) {
        vec2 reach = uRadius * ${BLOOM_MAX_RADIUS.toFixed(2)} * min(uRes.x, uRes.y) / uRes;
        float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        for (int i = 0; i < SAMPLES; i++) {
          float r = sqrt((float(i) + 0.5) / float(SAMPLES));
          float a = float(i) * 2.3999632 + spin;
          float w = exp(-r * r * 2.5);
          glow += w * bright(texture2D(uTex, vUv + reach * r * vec2(cos(a), sin(a))));
          total += w;
        }
      }
      glow *= uTint * uIntensity / total;
      float g = max(glow.r, max(glow.g, glow.b));
      if (g <= 0.0) {
        gl_FragColor = c;
        return;
      }
      float alpha = c.a + (1.0 - c.a) * min(g, 1.0);
      gl_FragColor = vec4(min((c.rgb * c.a + glow) / alpha, 1.0), alpha);
    }
  `,
  uniforms: ["uRes", "uThreshold", "uIntensity", "uRadius", "uTint"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    gl.uniform1f(
      loc.uThreshold,
      clampUnit(readEffectNumber(params, "_Threshold", 0.7)),
    );
    gl.uniform1f(
      loc.uIntensity,
      clampUnit(readEffectNumber(params, "_Intensity", 0.6), 0, 2),
    );
    gl.uniform1f(
      loc.uRadius,
      clampUnit(readEffectNumber(params, "_Radius", 0.4)),
    );
    const tint = readTint(params);
    gl.uniform3f(loc.uTint, tint.r / 255, tint.g / 255, tint.b / 255);
  },
};
