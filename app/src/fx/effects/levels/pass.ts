import {
  type EffectParameter,
  type EffectPass,
  findEffectParameter,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";
import {
  CURVE_LUT_SIZE,
  curveLut,
  isIdentityCurves,
  type LevelsCurves,
  parseCurves,
} from "./curve.ts";
import {
  CURVE_KEY,
  effectiveWheel,
  isIdentityGrade,
  type LevelsGrade,
  WHEEL_CHANNELS,
  WHEELS,
  type WheelDefinition,
  wheelKey,
} from "./levels.ts";

function readWheel(params: EffectParameter[], wheel: WheelDefinition) {
  const [y, r, g, b] = WHEEL_CHANNELS.map((channel) => {
    const value = readEffectNumber(
      params,
      wheelKey(wheel.name, channel),
      wheel.defaultValue,
    );
    return Math.max(wheel.min, Math.min(wheel.max, value));
  });
  return effectiveWheel(wheel, { y, r, g, b });
}

// The wheels' values for red, green and blue.
export function readLevelsGrade(params: EffectParameter[]): LevelsGrade {
  const [lift, gamma, gain, offset] = WHEELS.map((wheel) =>
    readWheel(params, wheel),
  );
  return { lift, gamma, gain, offset };
}

// The last curve text parsed and its lookup table, since it rarely changes
// between frames.
let cachedCurve: {
  value: string;
  curves: LevelsCurves;
  lut: Float32Array;
} | null = null;

export function readLevelsCurve(params: EffectParameter[]) {
  const value = findEffectParameter(params, CURVE_KEY)?.value ?? "";
  if (cachedCurve?.value !== value) {
    const curves = parseCurves(value);
    cachedCurve = { value, curves, lut: curveLut(curves) };
  }
  return cachedCurve;
}

// Grades each pixel's straight (unpremultiplied) color, as every pass reads
// it, with the Lift, Gamma, Gain and Offset wheels (see `gradeLevel`), then
// the tone curves, baked into a lookup table of the master curve followed
// by each channel's own. Alpha is left as it is. Nothing depends on time or
// the output size, so preview and export match.
export const pass: EffectPass = {
  effectName: "Levels",
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform vec3 uOffset;
    uniform float uCurveOn;
    uniform vec3 uCurve[${CURVE_LUT_SIZE}];
    varying vec2 vUv;

    vec3 levelsCurve(vec3 level) {
      vec3 position = clamp(level, 0.0, 1.0) * ${(CURVE_LUT_SIZE - 1).toFixed(1)};
      vec3 result = vec3(0.0);
      for (int index = 0; index < ${CURVE_LUT_SIZE}; index++) {
        result += uCurve[index]
          * max(vec3(0.0), 1.0 - abs(position - float(index)));
      }
      return result;
    }

    void main() {
      vec4 c = texture2D(uTex, vUv);
      vec3 level = c.rgb + uOffset;
      level = clamp(uLift + level * (uGain - uLift), 0.0, 1.0);
      level = pow(level, exp2(-uGamma));
      if (uCurveOn > 0.5) {
        level = levelsCurve(level);
      }
      gl_FragColor = vec4(clamp(level, 0.0, 1.0), c.a);
    }
  `,
  uniforms: ["uLift", "uGamma", "uGain", "uOffset", "uCurveOn", "uCurve"],
  setUniforms(gl, loc, params) {
    const { lift, gamma, gain, offset } = readLevelsGrade(params);
    gl.uniform3f(loc.uLift, lift[0], lift[1], lift[2]);
    gl.uniform3f(loc.uGamma, gamma[0], gamma[1], gamma[2]);
    gl.uniform3f(loc.uGain, gain[0], gain[1], gain[2]);
    gl.uniform3f(loc.uOffset, offset[0], offset[1], offset[2]);
    const { curves, lut } = readLevelsCurve(params);
    gl.uniform1f(loc.uCurveOn, isIdentityCurves(curves) ? 0 : 1);
    gl.uniform3fv(loc.uCurve, lut);
  },
  // The wheels at their defaults and straight curves leave the picture as
  // it is.
  isIdentity(params) {
    return (
      isIdentityGrade(readLevelsGrade(params)) &&
      isIdentityCurves(readLevelsCurve(params).curves)
    );
  },
};
