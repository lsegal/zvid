import {
  clampUnit,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// Snaps the image to square blocks. `_NumPixels` (0..1) sets the amount on an
// exponential curve from 1px up to 1/8 of the short edge. The music moves it
// only through the Animation modifier's Reactive mode.
export const pass: EffectPass = {
  effectName: "Pixelate",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uNum;
    varying vec2 vUv;

    void main() {
      float block = max(1.0, pow(2.0, uNum * log2(min(uRes.x, uRes.y) / 8.0)));
      vec2 cell = block / uRes;
      vec2 uv = (floor(vUv / cell) + 0.5) * cell;
      gl_FragColor = texture2D(uTex, uv);
    }
  `,
  uniforms: ["uRes", "uNum"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    gl.uniform1f(
      loc.uNum,
      clampUnit(readEffectNumber(params, "_NumPixels", 0)),
    );
  },
};
