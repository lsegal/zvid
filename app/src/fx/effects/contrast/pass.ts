import {
  clampUnit,
  type EffectParameter,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

export const CONTRAST_MAX = 2;
export const CONTRAST_DEFAULT = 1;
export const CONTRAST_DEFAULT_PIVOT = 0.435;

export function readContrast(params: EffectParameter[]) {
  return clampUnit(
    readEffectNumber(params, "_Contrast", CONTRAST_DEFAULT),
    0,
    CONTRAST_MAX,
  );
}

export function readPivot(params: EffectParameter[]) {
  return clampUnit(
    readEffectNumber(params, "_Pivot", CONTRAST_DEFAULT_PIVOT),
    0,
    1,
  );
}

// One channel as the shader computes it: moved away from `pivot` by
// `contrast`, and clamped.
export function contrastChannel(value: number, contrast: number, pivot: number) {
  return Math.min(Math.max((value - pivot) * contrast + pivot, 0), 1);
}

// Scales each channel's distance from Pivot by Contrast. The chain hands
// passes straight (unpremultiplied) color, so the curve applies to the
// color itself and a translucent pixel's alpha neither shifts its pivot nor
// changes; it is passed through as it is.
export const pass: EffectPass = {
  effectName: "Contrast",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uContrast;
    uniform float uPivot;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(uTex, vUv);
      vec3 rgb = (c.rgb - vec3(uPivot)) * uContrast + vec3(uPivot);
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  uniforms: ["uContrast", "uPivot"],
  setUniforms(gl, loc, params) {
    gl.uniform1f(loc.uContrast, readContrast(params));
    gl.uniform1f(loc.uPivot, readPivot(params));
  },
  // Contrast 1 leaves every channel where it was, whatever the Pivot.
  isIdentity(params) {
    return readContrast(params) === 1;
  },
};
