import {
  clampUnit,
  type EffectContext,
  type EffectParameter,
  type EffectPass,
  type EffectUniformLocations,
  effectPixelScale,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// Distance in output pixels at 1080p: its knob's range and default.
export const MOTION_BLUR_MAX_DISTANCE = 400;
export const MOTION_BLUR_DEFAULT_DISTANCE = 60;

// The reads each stage takes along the smear. Two stages of them make
// MOTION_BLUR_TAPS² evenly spaced reads, under half a pixel apart even at
// the longest Distance in 2160p.
export const MOTION_BLUR_TAPS = 32;

export function readAngle(params: EffectParameter[]) {
  return clampUnit(readEffectNumber(params, "_Angle", 0), 0, 180);
}

export function readDistance(params: EffectParameter[]) {
  return clampUnit(
    readEffectNumber(params, "_Distance", MOTION_BLUR_DEFAULT_DISTANCE),
    0,
    MOTION_BLUR_MAX_DISTANCE,
  );
}

// The smear's full length in pixels of the picture `ctx` describes.
function lengthPixels(params: EffectParameter[], ctx: EffectContext) {
  return readDistance(params) * effectPixelScale(ctx);
}

// The step between a stage's reads in texture coordinates: the smear's
// length over MOTION_BLUR_TAPS for the first stage (`fine` false), and over
// MOTION_BLUR_TAPS² for the second, which fills the gaps between the
// first's. 0° runs left to right and 90° up the screen, whichever way up
// the picture is stored.
export function smearStep(
  params: EffectParameter[],
  ctx: EffectContext,
  fine: boolean,
): [number, number] {
  const radians = (readAngle(params) * Math.PI) / 180;
  const length =
    lengthPixels(params, ctx) / MOTION_BLUR_TAPS / (fine ? MOTION_BLUR_TAPS : 1);
  const [width, height] = ctx.resolution;
  return [
    (Math.cos(radians) * length) / Math.max(1, width),
    ((ctx.bottomUp ? 1 : -1) * Math.sin(radians) * length) / Math.max(1, height),
  ];
}

// One stage of the smear: the average of MOTION_BLUR_TAPS reads of `source`
// centered on the pixel, `uStep` apart. `premultiply` weights the picture's
// color by its alpha first.
function smearSource(source: string, premultiply: boolean) {
  const read = premultiply
    ? `c = texture2D(${source}, vUv + offset * uStep);
        sum += vec4(c.rgb * c.a, c.a);`
    : `sum += texture2D(${source}, vUv + offset * uStep);`;
  return `
    uniform sampler2D ${source};
    uniform vec2 uStep;
    varying vec2 vUv;

    void main() {
      vec4 sum = vec4(0.0);
      vec4 c;
      for (int tap = 0; tap < ${MOTION_BLUR_TAPS}; tap++) {
        float offset = float(tap) - ${(MOTION_BLUR_TAPS - 1) / 2};
        ${read}
      }
      gl_FragColor = sum / ${MOTION_BLUR_TAPS}.0;
    }
  `;
}

function setStep(
  gl: WebGLRenderingContext,
  loc: EffectUniformLocations,
  params: EffectParameter[],
  ctx: EffectContext,
  fine: boolean,
) {
  const [x, y] = smearStep(params, ctx, fine);
  gl.uniform2f(loc.uStep, x, y);
}

// Smears the picture evenly along `_Angle` over `_Distance`, in output
// pixels at 1080p scaled to the output size, centered on each pixel as a
// shutter open while the picture moved would. The first stage averages
// reads spread over the whole length, and the second averages reads
// spread over the gap between two of the first's, so together they average
// MOTION_BLUR_TAPS² reads evenly along it: a smooth smear with no ghosted
// copies, and nothing blurred across it. The picture is premultiplied by its
// alpha, so transparent areas don't darken the edges they meet, and every
// read is clamped to the picture's edges rather than wrapping. Nothing
// depends on time, so preview and export match.
export const pass: EffectPass = {
  effectName: "MotionBlur",
  stages: [
    {
      name: "uSmearCoarse",
      fragmentSource: smearSource("uTex", true),
      uniforms: ["uStep"],
      setUniforms(gl, loc, params, ctx) {
        setStep(gl, loc, params, ctx, false);
      },
    },
    {
      name: "uSmear",
      fragmentSource: smearSource("uSmearCoarse", false),
      uniforms: ["uStep"],
      setUniforms(gl, loc, params, ctx) {
        setStep(gl, loc, params, ctx, true);
      },
    },
  ],
  // Full size, so nothing is softened across the smear.
  stageScale(params, ctx) {
    return lengthPixels(params, ctx) > 0 ? 1 : 0;
  },
  fragmentSource: `
    uniform sampler2D uTex;
    uniform sampler2D uSmear;
    uniform float uLength;
    varying vec2 vUv;

    void main() {
      if (uLength <= 0.0) {
        gl_FragColor = texture2D(uTex, vUv);
        return;
      }
      vec4 smeared = texture2D(uSmear, vUv);
      gl_FragColor = smeared.a > 0.0
        ? vec4(min(smeared.rgb / smeared.a, 1.0), smeared.a)
        : vec4(0.0);
    }
  `,
  uniforms: ["uLength"],
  // With no length the stages are skipped, so the picture passes through.
  setUniforms(gl, loc, params, ctx) {
    gl.uniform1f(loc.uLength, lengthPixels(params, ctx));
  },
  // Distance 0 leaves the picture sharp.
  isIdentity(params) {
    return readDistance(params) <= 0;
  },
};
