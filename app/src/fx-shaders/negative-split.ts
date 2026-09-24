import { clampUnit, type EffectPass, readEffectNumber } from "./types";

// Inverts the image by luminance range: `_LowIntensity` drives the dark half
// and `_HighIntensity` the bright half, with a soft split at luma 0.5. The
// matching audio band boosts each side.
export const negativeSplitPass: EffectPass = {
  effectName: "NegativeSplit",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uLow, uHigh, uAudioLow, uAudioHigh;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(uTex, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      float w = smoothstep(0.45, 0.55, l);
      float amt = mix(clamp(uLow + uAudioLow * uLow, 0.0, 1.0),
                      clamp(uHigh + uAudioHigh * uHigh, 0.0, 1.0), w);
      gl_FragColor = vec4(mix(c.rgb, 1.0 - c.rgb, amt), c.a);
    }
  `,
  uniforms: ["uLow", "uHigh", "uAudioLow", "uAudioHigh"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform1f(
      loc.uLow,
      clampUnit(readEffectNumber(params, "_LowIntensity", 0)),
    );
    gl.uniform1f(
      loc.uHigh,
      clampUnit(readEffectNumber(params, "_HighIntensity", 0)),
    );
    gl.uniform1f(loc.uAudioLow, ctx.audioLow);
    gl.uniform1f(loc.uAudioHigh, ctx.audioHigh);
  },
};
