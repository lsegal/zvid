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

// The most reads either stage takes along the smear.
export const MOTION_BLUR_TAPS = 64;

// The comb stage's copies, at most, before its step grows past a pixel.
const COMB_COPIES = 32;

// The longest comb step in pixels, so the fine stage's reads stay half a
// pixel apart.
const MAX_COMB_STEP = MOTION_BLUR_TAPS / 2;

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

export type SmearStage = {
  // The step between reads in texture coordinates.
  step: [number, number];
  taps: number;
};

// The smear's two stages along `_Angle` over `_Distance`. The comb lays
// copies of the fine stage end to end along the length, each a whole number
// of pixels along the direction's main axis from the next, so on the pixel
// grid they tile into one even smear with no ripple or ghosting. The fine
// stage spreads each pixel over one comb step, with reads half a pixel
// apart. 0° runs left to right and 90° up the screen, whichever way up the
// picture is stored.
export function smearStages(
  params: EffectParameter[],
  ctx: EffectContext,
): { fine: SmearStage; comb: SmearStage } {
  const radians = (readAngle(params) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  // Pixels along the main axis per pixel along the smear.
  const axis = Math.max(Math.abs(cos), Math.abs(sin));
  const length = lengthPixels(params, ctx) * axis;
  const combStep =
    length <= 1
      ? length
      : clampUnit(Math.round(length / COMB_COPIES), 1, MAX_COMB_STEP);
  const copies =
    combStep > 0
      ? clampUnit(Math.round(length / combStep), 1, MOTION_BLUR_TAPS)
      : 1;
  const fineTaps = clampUnit(Math.ceil(2 * combStep), 1, MOTION_BLUR_TAPS);
  const [width, height] = ctx.resolution;
  const step = (pixels: number): [number, number] => [
    (cos * pixels) / axis / Math.max(1, width),
    ((ctx.bottomUp ? 1 : -1) * sin * pixels) / axis / Math.max(1, height),
  ];
  return {
    fine: { step: step(combStep / fineTaps), taps: fineTaps },
    comb: { step: step(combStep), taps: copies },
  };
}

// One stage of the smear: the average of `uTaps` reads of `source`
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
    uniform float uTaps;
    varying vec2 vUv;

    void main() {
      vec4 sum = vec4(0.0);
      vec4 c;
      for (int tap = 0; tap < ${MOTION_BLUR_TAPS}; tap++) {
        if (float(tap) >= uTaps) break;
        float offset = float(tap) - 0.5 * (uTaps - 1.0);
        ${read}
      }
      gl_FragColor = sum / uTaps;
    }
  `;
}

function setStage(
  gl: WebGLRenderingContext,
  loc: EffectUniformLocations,
  { step, taps }: SmearStage,
) {
  gl.uniform2f(loc.uStep, step[0], step[1]);
  gl.uniform1f(loc.uTaps, taps);
}

// Smears the picture evenly along `_Angle` over `_Distance`, in output
// pixels at 1080p scaled to the output size, centered on each pixel as a
// shutter open while the picture moved would, in two stages (see
// `smearStages`). Both are drawn at full size, so nothing is blurred across
// the smear. The picture is premultiplied by its alpha, so transparent
// areas don't darken the edges they meet, and every read is clamped to the
// picture's edges rather than wrapping. Nothing depends on time, so preview
// and export match.
export const pass: EffectPass = {
  effectName: "MotionBlur",
  stages: [
    {
      name: "uSmearFine",
      fragmentSource: smearSource("uTex", true),
      uniforms: ["uStep", "uTaps"],
      setUniforms(gl, loc, params, ctx) {
        setStage(gl, loc, smearStages(params, ctx).fine);
      },
    },
    {
      name: "uSmear",
      fragmentSource: smearSource("uSmearFine", false),
      uniforms: ["uStep", "uTaps"],
      setUniforms(gl, loc, params, ctx) {
        setStage(gl, loc, smearStages(params, ctx).comb);
      },
    },
  ],
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
  // Half the smear reaches each way along its direction.
  spread(params, ctx) {
    const half = lengthPixels(params, ctx) / 2;
    const radians = (readAngle(params) * Math.PI) / 180;
    return [
      half * Math.abs(Math.cos(radians)),
      half * Math.abs(Math.sin(radians)),
    ];
  },
  // Distance 0 leaves the picture sharp.
  isIdentity(params) {
    return readDistance(params) <= 0;
  },
};
