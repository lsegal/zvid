import {
  clampUnit,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// Inverts the image by luminance range: `_LowIntensity` drives the dark half
// and `_HighIntensity` the bright half, with a soft split at luma 0.5. The
// music moves them only through the Animation modifier's Reactive mode.
export const pass: EffectPass = {
  effectName: "NegativeSplit",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uLow, uHigh;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(uTex, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float w = smoothstep(0.45, 0.55, l);
      float amt = mix(uLow, uHigh, w);
      gl_FragColor = vec4(mix(c.rgb, 1.0 - c.rgb, amt), c.a);
    }
  `,
  uniforms: ["uLow", "uHigh"],
  setUniforms(gl, loc, params) {
    gl.uniform1f(
      loc.uLow,
      clampUnit(readEffectNumber(params, "_LowIntensity", 0)),
    );
    gl.uniform1f(
      loc.uHigh,
      clampUnit(readEffectNumber(params, "_HighIntensity", 0)),
    );
  },
  // Neither side inverts at intensity 0.
  isIdentity(params) {
    return (
      clampUnit(readEffectNumber(params, "_LowIntensity", 0)) <= 0 &&
      clampUnit(readEffectNumber(params, "_HighIntensity", 0)) <= 0
    );
  },
};
