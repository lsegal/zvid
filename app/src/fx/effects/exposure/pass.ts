import {
  clampUnit,
  type EffectParameter,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";
import { EXPOSURE_MAX_STOPS } from "./definition.ts";

// The `_Stops` knob, clamped to its range.
export function exposureStops(params: EffectParameter[]) {
  return clampUnit(
    readEffectNumber(params, "_Stops", 0),
    -EXPOSURE_MAX_STOPS,
    EXPOSURE_MAX_STOPS,
  );
}

// The sRGB transfer functions, matching the shader's.
export function srgbToLinear(value: number) {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value: number) {
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * value ** (1 / 2.4) - 0.055;
}

// One straight-alpha sRGB pixel (0..1 channels) exposed by `stops`, as the
// shader draws it: the color scaled by 2^stops in linear light and clamped
// to the displayable range, its alpha left as it was.
export function exposePixel(
  [red, green, blue, alpha]: readonly [number, number, number, number],
  stops: number,
): [number, number, number, number] {
  const gain = 2 ** stops;
  const expose = (value: number) =>
    linearToSrgb(Math.min(Math.max(srgbToLinear(value) * gain, 0), 1));
  return [expose(red), expose(green), expose(blue), alpha];
}

// Scales the light by 2^`_Stops`, -4..4 stops, in linear light: the sRGB
// color is decoded, multiplied and clamped, then encoded again. The chain's
// pictures carry straight alpha, so the color is exposed on its own and
// alpha passes through; a premultiplied color would come out the same, as
// the scale is per channel and clamping to 1 is clamping to alpha. Nothing
// depends on time, so preview and export match.
export const pass: EffectPass = {
  effectName: "Exposure",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uGain;
    varying vec2 vUv;

    vec3 toLinear(vec3 c) {
      return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)),
        step(vec3(0.04045), c));
    }

    vec3 toSrgb(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
        step(vec3(0.0031308), c));
    }

    void main() {
      vec4 c = texture2D(uTex, vUv);
      vec3 exposed = clamp(toLinear(c.rgb) * uGain, 0.0, 1.0);
      gl_FragColor = vec4(toSrgb(exposed), c.a);
    }
  `,
  uniforms: ["uGain"],
  setUniforms(gl, loc, params) {
    gl.uniform1f(loc.uGain, 2 ** exposureStops(params));
  },
  // No stops leave the light as it is.
  isIdentity(params) {
    return exposureStops(params) === 0;
  },
};
