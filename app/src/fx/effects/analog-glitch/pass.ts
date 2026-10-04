import {
  clampUnit,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// Tears horizontal bands, splits the RGB channels and rolls the frame.
// `_LowMod` drives tearing and roll; `_HighMod` drives the channel split and
// fine jitter. The music moves them only through the Animation modifier's
// Reactive mode. Every random value hashes the playhead time, so scrubbing to
// a time always gives the same frame. The 24 Hz frame counter wraps so the
// hash stays precise at mediump. `uDown` keeps the roll moving the same way
// on top-down and bottom-up textures.
export const pass: EffectPass = {
  effectName: "AnalogGlitch",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uTime, uDown, uLowMod, uHighMod;
    varying vec2 vUv;

    float h(float n) { return fract(sin(n) * 43758.5453); }

    void main() {
      float lo = uLowMod;
      float hi = uHighMod;
      float t = mod(floor(uTime * 24.0), 1024.0);
      float row = floor(vUv.y * 64.0);
      float tear = step(1.0 - lo * 0.35, h(row + t * 7.13)) * (h(row * 3.7 + t) - 0.5) * 0.12 * lo;
      float jitter = (h(vUv.y * 480.0 + t) - 0.5) * 0.004 * hi;
      vec2 uv = vec2(vUv.x + tear + jitter, fract(vUv.y + uDown * lo * 0.02 * sin(uTime * 3.0)));
      float split = 0.012 * hi;
      vec4 g = texture2D(uTex, uv);
      float r = texture2D(uTex, uv + vec2(split, 0.0)).r;
      float b = texture2D(uTex, uv - vec2(split, 0.0)).b;
      float scan = 1.0 - 0.08 * lo * step(0.5, fract(vUv.y * 240.0));
      gl_FragColor = vec4(vec3(r, g.g, b) * scan, g.a);
    }
  `,
  uniforms: ["uTime", "uDown", "uLowMod", "uHighMod"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform1f(loc.uTime, ctx.time);
    gl.uniform1f(loc.uDown, ctx.bottomUp ? -1 : 1);
    gl.uniform1f(
      loc.uLowMod,
      clampUnit(readEffectNumber(params, "_LowMod", 0)),
    );
    gl.uniform1f(
      loc.uHighMod,
      clampUnit(readEffectNumber(params, "_HighMod", 0)),
    );
  },
  // No modulation tears, jitters, splits or darkens nothing.
  isIdentity(params) {
    return (
      clampUnit(readEffectNumber(params, "_LowMod", 0)) <= 0 &&
      clampUnit(readEffectNumber(params, "_HighMod", 0)) <= 0
    );
  },
};
