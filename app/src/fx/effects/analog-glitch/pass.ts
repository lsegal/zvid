import {
  clampUnit,
  type EffectPass,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";

// The glitch's random values change at this many frames a second.
const GLITCH_RATE = 24;

// Frames before the frame counter wraps around.
const GLITCH_FRAMES = 1024;

// The roll's angular rate, in radians per second.
const ROLL_RATE = 3;

function wrap(value: number, period: number) {
  const wrapped = value % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

// The frame counter and roll phase at `time`, wrapped here in double
// precision so the shader's mediump floats (16-bit on Apple GPUs) stay
// precise however far into the timeline the playhead is.
export function glitchClock(time: number) {
  return {
    frame: wrap(Math.floor(time * GLITCH_RATE), GLITCH_FRAMES),
    roll: wrap(time * ROLL_RATE, 2 * Math.PI),
  };
}

// Tears horizontal bands, splits the RGB channels and rolls the frame.
// `_LowMod` drives tearing and roll; `_HighMod` drives the channel split and
// fine jitter. The music moves them only through the Animation modifier's
// Reactive mode. Every random value hashes the playhead time, so scrubbing to
// a time always gives the same frame. The 24 Hz frame counter and the roll's
// phase arrive wrapped (see `glitchClock`). `uDown` keeps the roll moving the
// same way on top-down and bottom-up textures.
export const pass: EffectPass = {
  effectName: "AnalogGlitch",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform float uFrame, uRoll, uDown, uLowMod, uHighMod;
    varying vec2 vUv;

    float h(float n) { return fract(sin(n) * 43758.5453); }

    void main() {
      float lo = uLowMod;
      float hi = uHighMod;
      float t = uFrame;
      float row = floor(vUv.y * 64.0);
      float tear = step(1.0 - lo * 0.35, h(row + t * 7.13)) * (h(row * 3.7 + t) - 0.5) * 0.12 * lo;
      float jitter = (h(vUv.y * 480.0 + t) - 0.5) * 0.004 * hi;
      vec2 uv = vec2(vUv.x + tear + jitter, fract(vUv.y + uDown * lo * 0.02 * sin(uRoll)));
      float split = 0.012 * hi;
      vec4 g = texture2D(uTex, uv);
      float r = texture2D(uTex, uv + vec2(split, 0.0)).r;
      float b = texture2D(uTex, uv - vec2(split, 0.0)).b;
      float scan = 1.0 - 0.08 * lo * step(0.5, fract(vUv.y * 240.0));
      gl_FragColor = vec4(vec3(r, g.g, b) * scan, g.a);
    }
  `,
  uniforms: ["uFrame", "uRoll", "uDown", "uLowMod", "uHighMod"],
  setUniforms(gl, loc, params, ctx) {
    const { frame, roll } = glitchClock(ctx.time);
    gl.uniform1f(loc.uFrame, frame);
    gl.uniform1f(loc.uRoll, roll);
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
};
