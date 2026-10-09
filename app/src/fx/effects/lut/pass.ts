import { effectTextureUnit } from "../../../fx-shaders/effect-texture-units.ts";
import {
  clampUnit,
  type EffectPass,
  findEffectParameter,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";
import { INTENSITY_KEY, LUT_EFFECT_NAME, LUT_KEY } from "./lut.ts";
import { bindLutTexture, isLutReady } from "./lut-media.ts";

// Grades each pixel through a 3D LUT stored as a grid of blue slices (see
// lut-texture.ts): bilinear within the two slices either side of its blue,
// mixed between them, which is trilinear interpolation. The picture's color
// is not premultiplied, so the color is graded as it is and alpha is kept.
// Intensity mixes the graded color over the original.
export const pass: EffectPass = {
  effectName: LUT_EFFECT_NAME,
  fragmentSource: `
    uniform sampler2D uTex;
    uniform sampler2D uLut;
    uniform float uLutSize;
    uniform vec2 uLutGrid;
    uniform vec3 uDomainMin;
    uniform vec3 uDomainScale;
    uniform float uIntensity;
    varying vec2 vUv;

    vec2 lutSliceUv(float slice, vec2 rg) {
      float row = floor((slice + 0.5) / uLutGrid.x);
      float column = slice - row * uLutGrid.x;
      return (vec2(column, row) * uLutSize + rg + 0.5) / (uLutGrid * uLutSize);
    }

    void main() {
      vec4 c = texture2D(uTex, vUv);
      vec3 cell = clamp((c.rgb - uDomainMin) * uDomainScale, 0.0, 1.0)
        * (uLutSize - 1.0);
      float slice = floor(cell.b);
      float next = min(slice + 1.0, uLutSize - 1.0);
      // The LUT is a texture of its own size, so it is read unscaled: the
      // chain scales texture2D lookups to its pooled input's corner.
      vec3 low = texture2DProj(uLut, vec3(lutSliceUv(slice, cell.rg), 1.0)).rgb;
      vec3 high = texture2DProj(uLut, vec3(lutSliceUv(next, cell.rg), 1.0)).rgb;
      vec3 graded = mix(low, high, cell.b - slice);
      gl_FragColor = vec4(mix(c.rgb, graded, uIntensity), c.a);
    }
  `,
  uniforms: [
    "uLut",
    "uLutSize",
    "uLutGrid",
    "uDomainMin",
    "uDomainScale",
    "uIntensity",
  ],
  setUniforms(gl, loc, params) {
    const unit = loc.uLut ? effectTextureUnit(loc.uLut) : -1;
    const bound =
      unit >= 0
        ? bindLutTexture(gl, findEffectParameter(params, LUT_KEY)?.value, unit)
        : undefined;
    gl.uniform1i(loc.uLut, bound ? unit : 0);
    const size = bound?.layout.size ?? 2;
    gl.uniform1f(loc.uLutSize, size);
    gl.uniform2f(
      loc.uLutGrid,
      bound?.layout.columns ?? 1,
      bound?.layout.rows ?? 1,
    );
    const min = bound?.domainMin ?? [0, 0, 0];
    const max = bound?.domainMax ?? [1, 1, 1];
    gl.uniform3f(loc.uDomainMin, min[0], min[1], min[2]);
    gl.uniform3f(
      loc.uDomainScale,
      1 / (max[0] - min[0]),
      1 / (max[1] - min[1]),
      1 / (max[2] - min[2]),
    );
    // Without a LUT to read, the picture is left as it is.
    gl.uniform1f(
      loc.uIntensity,
      bound ? clampUnit(readEffectNumber(params, INTENSITY_KEY, 1)) : 0,
    );
  },
  // None, no Intensity, or a LUT not loaded yet, offline or rejected leaves
  // the picture as it is.
  isIdentity(params) {
    return (
      clampUnit(readEffectNumber(params, INTENSITY_KEY, 1)) === 0 ||
      !isLutReady(findEffectParameter(params, LUT_KEY)?.value)
    );
  },
};
