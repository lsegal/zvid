import {
  clampUnit,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// Rotates hue in YIQ space. `_HueOffset` (-1..1) maps to +/-360 degrees and
// `_Reactivity` scales a hue swing driven by hits detected in the main audio
// bands (see audio-bands.ts).
export const pass: EffectPass = {
  effectName: "Colorize",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uHueOffset, uReactivity, uImpulseLow, uImpulseHigh;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(uTex, vUv);
      float a = 6.2831853 * (uHueOffset + uReactivity * (uImpulseLow * 0.5 + uImpulseHigh * 0.5));
      mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
      mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
      vec3 yiq = toYIQ * c.rgb;
      float s = sin(a), co = cos(a);
      yiq.yz = mat2(co, s, -s, co) * yiq.yz;
      gl_FragColor = vec4(clamp(toRGB * yiq, 0.0, 1.0), c.a);
    }
  `,
  uniforms: ["uHueOffset", "uReactivity", "uImpulseLow", "uImpulseHigh"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform1f(
      loc.uHueOffset,
      clampUnit(readEffectNumber(params, "_HueOffset", 0), -1, 1),
    );
    gl.uniform1f(loc.uReactivity, readEffectNumber(params, "_Reactivity", 0));
    gl.uniform1f(loc.uImpulseLow, ctx.impulseLow);
    gl.uniform1f(loc.uImpulseHigh, ctx.impulseHigh);
  },
};
