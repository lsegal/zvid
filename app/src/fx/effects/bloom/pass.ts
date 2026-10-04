import { parseCssColor } from "../../../fill-paint.ts";
import {
  clampUnit,
  type EffectContext,
  type EffectParameter,
  type EffectPass,
  type EffectUniformLocations,
  normalizeEffectKey,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

export const DEFAULT_BLOOM_TINT = "rgba(255,255,255,1)";

// The glow's reach at full Radius, as a fraction of the frame's shorter
// side.
export const BLOOM_MAX_RADIUS = 0.12;

// Taps on each side of a pixel in each direction of the blur, so the glow
// reaches BLOOM_TAPS stage texels where the stage scale allows.
export const BLOOM_TAPS = 16;

// The range of the stages' scale: the picture's own size for a glow
// reaching under BLOOM_TAPS pixels, and no coarser than an eighth of it
// however far the glow reaches.
const FINEST_STAGE = 1;
const COARSEST_STAGE = 1 / 8;

// Width of the soft knee above Threshold, in luminance.
const KNEE = 0.1;

// The Gaussian falloff of the glow across its reach, `r` from 0 to 1.
function falloff(r: number) {
  return Math.exp(-2.5 * r * r);
}

// The blur's weights and offsets, one direction at a time. Each pair of
// neighboring taps reads as one bilinear sample between them, weighted by
// their sum, so a side of BLOOM_TAPS taps takes BLOOM_TAPS / 2 reads.
function blurTaps() {
  const weights = Array.from({ length: BLOOM_TAPS + 1 }, (_, tap) =>
    falloff(tap / BLOOM_TAPS),
  );
  const total = weights[0] + 2 * weights.slice(1).reduce((a, b) => a + b, 0);
  const taps = [{ offset: 0, weight: weights[0] / total }];
  for (let tap = 1; tap < BLOOM_TAPS; tap += 2) {
    const weight = weights[tap] + weights[tap + 1];
    const offset = (tap * weights[tap] + (tap + 1) * weights[tap + 1]) / weight;
    taps.push({ offset, weight: weight / total });
  }
  return taps;
}

export const BLOOM_BLUR_TAPS = blurTaps();

// How much the gathered glow counts against the pixel's own light, as when
// the glow was gathered from 48 samples spread evenly over its reach, each
// weighted by its falloff, beside the pixel's own at weight 1.
export const BLOOM_SPREAD = Array.from({ length: 48 }, (_, sample) =>
  falloff(Math.sqrt((sample + 0.5) / 48)),
).reduce((a, b) => a + b, 0);

const WHITE = { r: 255, g: 255, b: 255, a: 1 };

// Parsed tints by value, so a steady Tint isn't parsed every frame.
const tints = new Map<string | undefined, typeof WHITE>();
const MAX_CACHED_TINTS = 64;

export function readTint(params: EffectParameter[]) {
  const target = normalizeEffectKey("_Tint");
  const value = params.find(
    (parameter) => normalizeEffectKey(parameter.key) === target,
  )?.value;
  let tint = tints.get(value);
  if (!tint) {
    if (tints.size >= MAX_CACHED_TINTS) {
      tints.clear();
    }
    tint = parseCssColor(value) ?? WHITE;
    tints.set(value, tint);
  }
  return tint;
}

function readThreshold(params: EffectParameter[]) {
  return clampUnit(readEffectNumber(params, "_Threshold", 0.7));
}

function readIntensity(params: EffectParameter[]) {
  return clampUnit(readEffectNumber(params, "_Intensity", 0.6), 0, 2);
}

function readRadius(params: EffectParameter[]) {
  return clampUnit(readEffectNumber(params, "_Radius", 0.4));
}

// The glow's reach in pixels of a picture `resolution` in size.
function reachPixels(params: EffectParameter[], resolution: number[]) {
  return (
    readRadius(params) *
    BLOOM_MAX_RADIUS *
    Math.min(resolution[0], resolution[1])
  );
}

// The light above Threshold, eased in over a soft knee so a pixel at or
// below it adds nothing, and weighted by alpha.
const BRIGHT = `
    uniform float uThreshold;
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
`;

// One direction of the blur: `source` read at the taps along `uTap`, the
// distance between neighboring taps in texture coordinates.
function blurSource(source: string) {
  const reads = BLOOM_BLUR_TAPS.map(({ offset, weight }) =>
    offset === 0
      ? `      sum += ${weight.toFixed(6)} * texture2D(${source}, vUv).rgb;`
      : `      sum += ${weight.toFixed(6)} * (texture2D(${source}, vUv + ${offset.toFixed(6)} * uTap).rgb + texture2D(${source}, vUv - ${offset.toFixed(6)} * uTap).rgb);`,
  );
  return `
    uniform sampler2D ${source};
    uniform vec2 uTap;
    varying vec2 vUv;

    void main() {
      vec3 sum = vec3(0.0);
${reads.join("\n")}
      gl_FragColor = vec4(sum, 1.0);
    }
  `;
}

// Sets `uTap` to the distance between taps that spreads the glow over its
// reach along `axis`, in texture coordinates.
function setTap(
  gl: WebGLRenderingContext,
  loc: EffectUniformLocations,
  params: EffectParameter[],
  ctx: EffectContext,
  axis: 0 | 1,
) {
  // The stage keeps the picture's aspect, so its size gives the reach too.
  const tap = reachPixels(params, ctx.resolution) / BLOOM_TAPS;
  gl.uniform2f(
    loc.uTap,
    axis === 0 ? tap / ctx.resolution[0] : 0,
    axis === 1 ? tap / ctx.resolution[1] : 0,
  );
}

// Bright areas glow into their surroundings. The light above `_Threshold`
// is gathered at a fraction of the picture's size, blurred with a Gaussian
// falloff out to `_Radius` one direction at a time, then tinted by `_Tint`
// and added by `_Intensity`. The stages are scaled so the reach spans about
// BLOOM_TAPS of their texels, which keeps the blur's taps a texel or so
// apart at any Radius. Nothing depends on time, so preview and export
// match. The blur is symmetric, so it needs no bottom-up correction. Light
// is weighted by each pixel's alpha and the glow raises alpha where it
// lands, so a bloomed logo glows over the layers beneath it. With no glow at
// a pixel it is passed through untouched.
export const pass: EffectPass = {
  effectName: "Bloom",
  stages: [
    {
      // The light above Threshold, averaged over each stage texel's
      // footprint from four reads.
      name: "uBloomLight",
      fragmentSource: `
        uniform sampler2D uTex;
        uniform vec2 uStep;
        varying vec2 vUv;
        ${BRIGHT}
        void main() {
          vec3 sum = bright(texture2D(uTex, vUv - uStep))
            + bright(texture2D(uTex, vUv + uStep))
            + bright(texture2D(uTex, vUv + vec2(uStep.x, -uStep.y)))
            + bright(texture2D(uTex, vUv + vec2(-uStep.x, uStep.y)));
          gl_FragColor = vec4(sum * 0.25, 1.0);
        }
      `,
      uniforms: ["uThreshold", "uStep"],
      setUniforms(gl, loc, params, ctx) {
        gl.uniform1f(loc.uThreshold, readThreshold(params));
        // A quarter of a stage texel, so the reads sit in its four
        // quadrants.
        gl.uniform2f(
          loc.uStep,
          0.25 / ctx.resolution[0],
          0.25 / ctx.resolution[1],
        );
      },
    },
    {
      name: "uBloomAcross",
      fragmentSource: blurSource("uBloomLight"),
      uniforms: ["uTap"],
      setUniforms(gl, loc, params, ctx) {
        setTap(gl, loc, params, ctx, 0);
      },
    },
    {
      name: "uBloomGlow",
      fragmentSource: blurSource("uBloomAcross"),
      uniforms: ["uTap"],
      setUniforms(gl, loc, params, ctx) {
        setTap(gl, loc, params, ctx, 1);
      },
    },
  ],
  stageScale(params, ctx) {
    if (readIntensity(params) <= 0 || readRadius(params) <= 0) {
      return 0;
    }
    return clampUnit(
      BLOOM_TAPS / Math.max(reachPixels(params, ctx.resolution), 1),
      COARSEST_STAGE,
      FINEST_STAGE,
    );
  },
  fragmentSource: `
    uniform sampler2D uTex;
    uniform sampler2D uBloomGlow;
    uniform float uIntensity, uRadius;
    uniform vec3 uTint;
    varying vec2 vUv;
    ${BRIGHT}
    void main() {
      vec4 c = texture2D(uTex, vUv);
      vec3 glow = bright(c);
      if (uIntensity > 0.0 && uRadius > 0.0) {
        glow = (glow + ${BLOOM_SPREAD.toFixed(4)} * texture2D(uBloomGlow, vUv).rgb) / ${(1 + BLOOM_SPREAD).toFixed(4)};
      }
      glow *= uTint * uIntensity;
      float g = max(glow.r, max(glow.g, glow.b));
      if (g <= 0.0) {
        gl_FragColor = c;
        return;
      }
      float alpha = c.a + (1.0 - c.a) * min(g, 1.0);
      gl_FragColor = vec4(min((c.rgb * c.a + glow) / alpha, 1.0), alpha);
    }
  `,
  uniforms: ["uThreshold", "uIntensity", "uRadius", "uTint"],
  setUniforms(gl, loc, params) {
    gl.uniform1f(loc.uThreshold, readThreshold(params));
    gl.uniform1f(loc.uIntensity, readIntensity(params));
    gl.uniform1f(loc.uRadius, readRadius(params));
    const tint = readTint(params);
    gl.uniform3f(loc.uTint, tint.r / 255, tint.g / 255, tint.b / 255);
  },
  // Intensity 0 adds no glow.
  isIdentity(params) {
    return clampUnit(readEffectNumber(params, "_Intensity", 0.6), 0, 2) <= 0;
  },
};
