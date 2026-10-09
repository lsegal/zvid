import type { EffectPass } from "../../../fx-shaders/types.ts";

// Never drawn into the picture (see `EffectPass.analyzes`). In the preview,
// while its panel shows, the chain copies the picture at its position into
// a small target with this shader and reads it back for the waveform.
export const pass: EffectPass = {
  effectName: "Scopes",
  analyzes: true,
  fragmentSource: `
    uniform sampler2D uTex;
    varying vec2 vUv;

    void main() {
      gl_FragColor = texture2D(uTex, vUv);
    }
  `,
  uniforms: [],
  setUniforms() {},
  isIdentity() {
    return true;
  },
};
