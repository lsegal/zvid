import {
  clampUnit,
  type EffectContext,
  type EffectParameter,
  type EffectPass,
  type EffectUniformLocations,
  effectPixelScale,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// Radius in output pixels at 1080p: its knob's range and default.
export const GAUSSIAN_BLUR_MAX_RADIUS = 100;
export const GAUSSIAN_BLUR_DEFAULT_RADIUS = 20;

// The most taps on each side of a pixel in each direction of the blur, a
// stage texel apart, read in pairs.
export const GAUSSIAN_BLUR_TAPS = 64;

// The reach in stage texels the stages are scaled to keep the blur within,
// well inside GAUSSIAN_BLUR_TAPS even once the stage can't shrink further.
const STAGE_REACH = 32;

// The range of the stages' scale: the picture's own size for a blur
// reaching under STAGE_REACH pixels, and no coarser than a quarter of it,
// which the source stage's four reads still cover every pixel of.
const FINEST_STAGE = 1;
const COARSEST_STAGE = 1 / 4;

// The blur's standard deviation as a share of its reach, so it has faded
// out by the reach.
const SIGMA = 1 / 3;

// The blur's reads along one direction, reaching `reach` taps: offsets in
// taps from the pixel, and normalized weights. Each pair of neighboring taps
// reads as one bilinear sample between them, weighted by their sum. The
// stage shaders compute the same in GLSL; this mirrors them for the tests.
export function blurReads(reach: number) {
  const sigma = Math.max(reach * SIGMA, 1e-3);
  const falloff = (tap: number) => Math.exp((-0.5 * tap * tap) / sigma ** 2);
  const reads = [{ offset: 0, weight: 1 }];
  for (let pair = 0; pair < GAUSSIAN_BLUR_TAPS / 2; pair++) {
    const near = 2 * pair + 1;
    const weight = falloff(near) + falloff(near + 1);
    if (near > reach + 1 || !(weight > 0)) {
      break;
    }
    reads.push({ offset: near + falloff(near + 1) / weight, weight });
  }
  const total =
    1 + 2 * reads.slice(1).reduce((sum, { weight }) => sum + weight, 0);
  return reads.map(({ offset, weight }) => ({
    offset,
    weight: weight / total,
  }));
}

function readRadius(params: EffectParameter[]) {
  return clampUnit(
    readEffectNumber(params, "_Radius", GAUSSIAN_BLUR_DEFAULT_RADIUS),
    0,
    GAUSSIAN_BLUR_MAX_RADIUS,
  );
}

// The blur's reach in pixels of the picture `ctx` describes.
function reachPixels(params: EffectParameter[], ctx: EffectContext) {
  return readRadius(params) * effectPixelScale(ctx);
}

// One direction of the blur: the premultiplied `source` read at the taps
// `uTap` apart in texture coordinates, out to `uReach` taps.
function blurSource(source: string) {
  return `
    uniform sampler2D ${source};
    uniform vec2 uTap;
    uniform float uReach, uSigma;
    varying vec2 vUv;

    void main() {
      vec4 sum = texture2D(${source}, vUv);
      float total = 1.0;
      float k = -0.5 / (uSigma * uSigma);
      for (int pair = 0; pair < ${GAUSSIAN_BLUR_TAPS / 2}; pair++) {
        float near = float(2 * pair + 1);
        float nearWeight = exp(k * near * near);
        float farWeight = exp(k * (near + 1.0) * (near + 1.0));
        float weight = nearWeight + farWeight;
        if (near > uReach + 1.0 || weight <= 0.0) break;
        vec2 offset = (near + farWeight / weight) * uTap;
        sum += weight * (texture2D(${source}, vUv + offset)
          + texture2D(${source}, vUv - offset));
        total += 2.0 * weight;
      }
      gl_FragColor = sum / total;
    }
  `;
}

// Sets `uTap`, `uReach` and `uSigma` to spread the blur over its reach
// along `axis` of a stage: taps a texel apart, or further where the reach
// is longer than GAUSSIAN_BLUR_TAPS texels.
function setTaps(
  gl: WebGLRenderingContext,
  loc: EffectUniformLocations,
  params: EffectParameter[],
  ctx: EffectContext,
  axis: 0 | 1,
) {
  // `ctx.pixelScale` is the stage's, so this is the reach in its texels.
  const reach = reachPixels(params, ctx);
  const tap = Math.max(1, reach / GAUSSIAN_BLUR_TAPS);
  gl.uniform2f(
    loc.uTap,
    axis === 0 ? tap / ctx.resolution[0] : 0,
    axis === 1 ? tap / ctx.resolution[1] : 0,
  );
  gl.uniform1f(loc.uReach, reach / tap);
  gl.uniform1f(loc.uSigma, Math.max((reach / tap) * SIGMA, 1e-3));
}

// How far from a stage texel's center, in picture pixels, the source
// stage's four reads sit for a stage `scale` of the picture's size: none at
// full size, so the picture is read as is, and a quarter of the texel's
// footprint once it is two pixels or more across, so their bilinear reads
// average all of it.
export function sourceReadOffset(scale: number) {
  const footprint = 1 / Math.max(scale, COARSEST_STAGE);
  return Math.min((footprint - 1) / 2, footprint / 4);
}

// Blurs the picture with a Gaussian falloff out to `_Radius`, in output
// pixels at 1080p scaled to the output size, one direction at a time. The
// picture is premultiplied by its alpha first, so transparent areas don't
// darken the edges they meet, and every read is clamped to the picture's
// edges rather than wrapping. The stages are scaled so a long reach spans
// about STAGE_REACH of their texels, and the taps sit a texel apart, so a
// pair of them reads as one bilinear sample exactly and the falloff stays
// smooth at any Radius. Nothing depends on time, so preview and export
// match.
export const pass: EffectPass = {
  effectName: "GaussianBlur",
  stages: [
    {
      // The premultiplied picture, averaged over each stage texel's
      // footprint from four reads.
      name: "uBlurSource",
      fragmentSource: `
        uniform sampler2D uTex;
        uniform vec2 uStep;
        varying vec2 vUv;

        vec4 premultiplied(vec4 c) {
          return vec4(c.rgb * c.a, c.a);
        }

        void main() {
          gl_FragColor = 0.25 * (
            premultiplied(texture2D(uTex, vUv - uStep))
            + premultiplied(texture2D(uTex, vUv + uStep))
            + premultiplied(texture2D(uTex, vUv + vec2(uStep.x, -uStep.y)))
            + premultiplied(texture2D(uTex, vUv + vec2(-uStep.x, uStep.y))));
        }
      `,
      uniforms: ["uStep"],
      setUniforms(gl, loc, _params, ctx) {
        const scale = ctx.stageScale ?? 1;
        const offset = sourceReadOffset(scale) * scale;
        gl.uniform2f(
          loc.uStep,
          offset / ctx.resolution[0],
          offset / ctx.resolution[1],
        );
      },
    },
    {
      name: "uBlurAcross",
      fragmentSource: blurSource("uBlurSource"),
      uniforms: ["uTap", "uReach", "uSigma"],
      setUniforms(gl, loc, params, ctx) {
        setTaps(gl, loc, params, ctx, 0);
      },
    },
    {
      name: "uBlurDown",
      fragmentSource: blurSource("uBlurAcross"),
      uniforms: ["uTap", "uReach", "uSigma"],
      setUniforms(gl, loc, params, ctx) {
        setTaps(gl, loc, params, ctx, 1);
      },
    },
  ],
  stageScale(params, ctx) {
    const reach = reachPixels(params, ctx);
    if (!(reach > 0)) {
      return 0;
    }
    return clampUnit(STAGE_REACH / reach, COARSEST_STAGE, FINEST_STAGE);
  },
  fragmentSource: `
    uniform sampler2D uTex;
    uniform sampler2D uBlurDown;
    uniform float uReach;
    varying vec2 vUv;

    void main() {
      if (uReach <= 0.0) {
        gl_FragColor = texture2D(uTex, vUv);
        return;
      }
      vec4 blurred = texture2D(uBlurDown, vUv);
      gl_FragColor = blurred.a > 0.0
        ? vec4(min(blurred.rgb / blurred.a, 1.0), blurred.a)
        : vec4(0.0);
    }
  `,
  uniforms: ["uReach"],
  // With no reach the stages are skipped, so the picture passes through.
  setUniforms(gl, loc, params, ctx) {
    gl.uniform1f(loc.uReach, reachPixels(params, ctx));
  },
  // Radius 0 leaves the picture sharp.
  isIdentity(params) {
    return readRadius(params) <= 0;
  },
};
