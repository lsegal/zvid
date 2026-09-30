import {
  clampUnit,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// Snaps the image to square blocks. `_NumPixels` (0..1) sets the base amount
// on an exponential curve from 1px up to 1/8 of the short edge, and hits in the
// low and high audio bands push it further, scaled by `_LowIntensity` and
// `_HighIntensity`.
export const pass: EffectPass = {
  effectName: "Pixelate",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uNum, uLow, uHigh, uImpulseLow, uImpulseHigh;
    varying vec2 vUv;

    void main() {
      float amt = clamp(uNum + uImpulseLow * uLow * 0.5 + uImpulseHigh * uHigh * 0.5, 0.0, 1.0);
      float block = max(1.0, pow(2.0, amt * log2(min(uRes.x, uRes.y) / 8.0)));
      vec2 cell = block / uRes;
      vec2 uv = (floor(vUv / cell) + 0.5) * cell;
      gl_FragColor = texture2D(uTex, uv);
    }
  `,
  uniforms: ["uRes", "uNum", "uLow", "uHigh", "uImpulseLow", "uImpulseHigh"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    gl.uniform1f(
      loc.uNum,
      clampUnit(readEffectNumber(params, "_NumPixels", 0)),
    );
    gl.uniform1f(
      loc.uLow,
      clampUnit(readEffectNumber(params, "_LowIntensity", 0)),
    );
    gl.uniform1f(
      loc.uHigh,
      clampUnit(readEffectNumber(params, "_HighIntensity", 0)),
    );
    gl.uniform1f(loc.uImpulseLow, ctx.impulseLow);
    gl.uniform1f(loc.uImpulseHigh, ctx.impulseHigh);
  },
};
