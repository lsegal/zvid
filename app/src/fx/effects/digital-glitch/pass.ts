import {
  clampUnit,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// The glitch pattern holds for one step of `_Rate` and the step counter
// wraps here, so the hash stays precise at mediump.
const STEP_WRAP = 1024;

// The glitch pattern's step at `time` seconds: every time within one step of
// `rate` per second gives the same step, so scrubbing to a time always gives
// the same frame.
export function glitchStep(time: number, rate: number) {
  const step = Math.floor(time * rate);
  return ((step % STEP_WRAP) + STEP_WRAP) % STEP_WRAP;
}

// Corrupts the frame like a damaged digital stream. Each step hashes every
// block and horizontal slice to pick the ones that glitch (`_Amount`), then
// moves them (`_Displace`), splits their channels (`_ChannelShift`) and
// posterizes them (`_ColorCrush`). `_BlockSize` sets the block and slice
// size. Blocks and slices are counted in image rows, with `uDown` turning
// the rows of a bottom-up texture, so both orientations glitch the same
// parts of the picture. Amount 0 leaves the frame untouched.
export const pass: EffectPass = {
  effectName: "DigitalGlitch",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uStep, uDown, uAmount, uBlock, uDisplace, uShift, uCrush;
    varying vec2 vUv;

    float h(float n) { return fract(sin(n) * 43758.5453); }
    float h2(vec2 p) { return h(dot(p, vec2(12.9898, 78.233))); }

    void main() {
      vec4 base = texture2D(uTex, vUv);
      if (uAmount <= 0.0) {
        gl_FragColor = base;
        return;
      }
      float blockPx = max(4.0, floor(min(uRes.x, uRes.y) * mix(0.02, 0.25, uBlock)));
      vec2 px = vec2(vUv.x, 0.5 + uDown * (vUv.y - 0.5)) * uRes;
      vec2 cell = floor(px / blockPx);
      float slice = floor(px.y / (blockPx * 0.5));
      float s = uStep;
      float blockHit = step(h2(cell + vec2(s * 1.37, s * 0.71)), uAmount);
      float sliceHit = step(h(slice * 1.93 + s * 7.13), uAmount * 0.35);
      if (blockHit + sliceHit <= 0.0) {
        gl_FragColor = base;
        return;
      }
      vec2 seed = blockHit > 0.0 ? cell + vec2(s * 0.37, s * 1.11) : vec2(slice * 0.53, s * 2.17);
      vec2 move = vec2(h2(seed + 3.1), h2(seed + 5.7)) - 0.5;
      move *= uDisplace * vec2(0.5, 0.25 * blockHit);
      vec2 uv = fract(vUv + vec2(move.x, uDown * move.y));
      float split = (h2(seed + 9.3) - 0.5) * 0.06 * uShift;
      vec4 g = texture2D(uTex, uv);
      float r = texture2D(uTex, fract(uv + vec2(split, 0.0))).r;
      float b = texture2D(uTex, fract(uv - vec2(split, 0.0))).b;
      vec3 color = vec3(r, g.g, b);
      if (uCrush > 0.0) {
        float levels = mix(32.0, 2.0, uCrush) - 1.0;
        color = floor(color * levels + 0.5) / levels;
      }
      gl_FragColor = vec4(color, g.a);
    }
  `,
  uniforms: [
    "uRes",
    "uStep",
    "uDown",
    "uAmount",
    "uBlock",
    "uDisplace",
    "uShift",
    "uCrush",
  ],
  setUniforms(gl, loc, params, ctx) {
    const rate = clampUnit(readEffectNumber(params, "_Rate", 8), 1, 30);
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    gl.uniform1f(loc.uStep, glitchStep(ctx.time, rate));
    gl.uniform1f(loc.uDown, ctx.bottomUp ? -1 : 1);
    gl.uniform1f(
      loc.uAmount,
      clampUnit(readEffectNumber(params, "_Amount", 0.3)),
    );
    gl.uniform1f(
      loc.uBlock,
      clampUnit(readEffectNumber(params, "_BlockSize", 0.4)),
    );
    gl.uniform1f(
      loc.uDisplace,
      clampUnit(readEffectNumber(params, "_Displace", 0.5)),
    );
    gl.uniform1f(
      loc.uShift,
      clampUnit(readEffectNumber(params, "_ChannelShift", 0.3)),
    );
    gl.uniform1f(
      loc.uCrush,
      clampUnit(readEffectNumber(params, "_ColorCrush", 0)),
    );
  },
  // Amount 0 glitches no block.
  isIdentity(params) {
    return (
      clampUnit(readEffectNumber(params, "_Amount", 0.3)) <= 0
    );
  },
};
