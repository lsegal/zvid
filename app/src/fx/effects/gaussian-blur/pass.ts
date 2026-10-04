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

// Taps on each side of a pixel in each direction of the blur, so the blur
// reaches GAUSSIAN_BLUR_TAPS stage texels where the stage scale allows.
export const GAUSSIAN_BLUR_TAPS = 32;

// The range of the stages' scale: the picture's own size for a blur
// reaching under GAUSSIAN_BLUR_TAPS pixels, and no coarser than a quarter
// of it, which the source stage's four reads still cover every pixel of.
const FINEST_STAGE = 1;
const COARSEST_STAGE = 1 / 4;

// The Gaussian falloff across the blur's reach, `r` from 0 to 1: a standard
// deviation of a third of the Radius, so it fades out by the reach.
function falloff(r: number) {
  return Math.exp(-4.5 * r * r);
}

// The blur's weights and offsets, one direction at a time. Each pair of
// neighboring taps reads as one bilinear sample between them, weighted by
// their sum, so a side of GAUSSIAN_BLUR_TAPS taps takes half as many reads.
function blurTaps() {
  const weights = Array.from({ length: GAUSSIAN_BLUR_TAPS + 1 }, (_, tap) =>
    falloff(tap / GAUSSIAN_BLUR_TAPS),
  );
  const total = weights[0] + 2 * weights.slice(1).reduce((a, b) => a + b, 0);
  const taps = [{ offset: 0, weight: weights[0] / total }];
  for (let tap = 1; tap < GAUSSIAN_BLUR_TAPS; tap += 2) {
    const weight = weights[tap] + weights[tap + 1];
    const offset = (tap * weights[tap] + (tap + 1) * weights[tap + 1]) / weight;
    taps.push({ offset, weight: weight / total });
  }
  return taps;
}

export const GAUSSIAN_BLUR_WEIGHTS = blurTaps();

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
// along `uTap`, the distance between neighboring taps in texture
// coordinates.
function blurSource(source: string) {
  const reads = GAUSSIAN_BLUR_WEIGHTS.map(({ offset, weight }) =>
    offset === 0
      ? `      sum += ${weight.toFixed(6)} * texture2D(${source}, vUv);`
      : `      sum += ${weight.toFixed(6)} * (texture2D(${source}, vUv + ${offset.toFixed(6)} * uTap) + texture2D(${source}, vUv - ${offset.toFixed(6)} * uTap));`,
  );
  return `
    uniform sampler2D ${source};
    uniform vec2 uTap;
    varying vec2 vUv;

    void main() {
      vec4 sum = vec4(0.0);
${reads.join("\n")}
      gl_FragColor = sum;
    }
  `;
}

// Sets `uTap` to the distance between taps that spreads the blur over its
// reach along `axis`, in texture coordinates of a stage.
function setTap(
  gl: WebGLRenderingContext,
  loc: EffectUniformLocations,
  params: EffectParameter[],
  ctx: EffectContext,
  axis: 0 | 1,
) {
  // `ctx.pixelScale` is the stage's, so this is the reach in its texels.
  const tap = reachPixels(params, ctx) / GAUSSIAN_BLUR_TAPS;
  gl.uniform2f(
    loc.uTap,
    axis === 0 ? tap / ctx.resolution[0] : 0,
    axis === 1 ? tap / ctx.resolution[1] : 0,
  );
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
// edges rather than wrapping. The stages are scaled so the reach spans
// about GAUSSIAN_BLUR_TAPS of their texels, which keeps the taps a texel or
// so apart at any Radius. Nothing depends on time, so preview and export
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
      uniforms: ["uTap"],
      setUniforms(gl, loc, params, ctx) {
        setTap(gl, loc, params, ctx, 0);
      },
    },
    {
      name: "uBlurDown",
      fragmentSource: blurSource("uBlurAcross"),
      uniforms: ["uTap"],
      setUniforms(gl, loc, params, ctx) {
        setTap(gl, loc, params, ctx, 1);
      },
    },
  ],
  stageScale(params, ctx) {
    const reach = reachPixels(params, ctx);
    if (!(reach > 0)) {
      return 0;
    }
    return clampUnit(
      GAUSSIAN_BLUR_TAPS / reach,
      COARSEST_STAGE,
      FINEST_STAGE,
    );
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
