import {
  clampUnit,
  type EffectParameter,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// (zoom, x, y) framing for one end of the move, each clamped to 0..1. The saved
// Y runs top-down; `bottomUp` flips it to match a bottom-up texture.
export function readZoomFraming(
  params: EffectParameter[],
  prefix: "_Start" | "_End",
  bottomUp = false,
): [number, number, number] {
  const y = clampUnit(readEffectNumber(params, `${prefix}_Y`, 0.5));
  return [
    clampUnit(readEffectNumber(params, `${prefix}_Zoom`, 0)),
    clampUnit(readEffectNumber(params, `${prefix}_X`, 0.5)),
    bottomUp ? 1 - y : y,
  ];
}

// Eases from the start framing to the end framing across the clip. Zoom 0..1
// maps to 1x..4x; X and Y 0..1 place the window inside the frame, with 0 the
// left/top edge and 1 the right/bottom edge, so it never samples outside the
// texture. Layer textures are uploaded top row first (UNPACK_FLIP_Y off), so
// vUv.y already runs top-down and the saved Y is used without flipping; the
// group stack's offscreen scene is bottom-up, so its Y is flipped instead.
export const pass: EffectPass = {
  effectName: "ZoomAndPan",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uProgress;
    uniform vec3 uStart, uEnd;
    varying vec2 vUv;

    void main() {
      vec3 k = mix(uStart, uEnd, smoothstep(0.0, 1.0, uProgress));
      float scale = 1.0 / mix(1.0, 4.0, k.x);
      vec2 origin = k.yz * (1.0 - scale);
      gl_FragColor = texture2D(uTex, origin + vUv * scale);
    }
  `,
  uniforms: ["uProgress", "uStart", "uEnd"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform1f(loc.uProgress, clampUnit(ctx.clipProgress));
    gl.uniform3f(
      loc.uStart,
      ...readZoomFraming(params, "_Start", ctx.bottomUp),
    );
    gl.uniform3f(loc.uEnd, ...readZoomFraming(params, "_End", ctx.bottomUp));
  },
  // Zoom 0 at both ends is 1x throughout, wherever it is centered.
  isIdentity(params) {
    return (
      readZoomFraming(params, "_Start")[0] <= 0 &&
      readZoomFraming(params, "_End")[0] <= 0
    );
  },
};
