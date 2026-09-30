// Helpers for the shader pass tests in each effect's folder.
/// <reference lib="dom" />
import type {
  EffectContext,
  EffectParameter,
  EffectPass,
  EffectUniformLocations,
} from "../fx-shaders/types.ts";

export const CONTEXT: EffectContext = {
  time: 2.5,
  clipProgress: 0.25,
  resolution: [1080, 1920],
  audioLow: 0.4,
  audioHigh: 0.6,
  impulseLow: 0.7,
  impulseHigh: 0.9,
  bottomUp: false,
};

export function params(values: Record<string, number>): EffectParameter[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    value: String(value),
    numericValue: value,
  }));
}

// Runs a pass's setUniforms against a stand-in context and returns the values
// it sent, keyed by uniform name.
export function uniformValues(
  pass: EffectPass,
  parameters: EffectParameter[],
  ctx = CONTEXT,
) {
  const values: Record<string, number[]> = {};
  const locations: EffectUniformLocations = {};
  for (const name of pass.uniforms) {
    locations[name] = { name } as unknown as WebGLUniformLocation;
  }
  const record =
    () =>
    (location: WebGLUniformLocation | null, ...args: number[]) => {
      values[(location as unknown as { name: string }).name] = args;
    };
  const gl = {
    uniform1f: record(),
    uniform2f: record(),
    uniform3f: record(),
  } as unknown as WebGLRenderingContext;
  pass.setUniforms(gl, locations, parameters, ctx);
  return values;
}
