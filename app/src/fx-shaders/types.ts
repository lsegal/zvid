export type EffectParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

export type EffectContext = {
  // Playhead position in seconds.
  time: number;
  // How far the playhead is through the current clip, 0..1.
  clipProgress: number;
  // Size in pixels of the surface the pass renders to.
  resolution: [number, number];
  // Smoothed main-audio band energy, 0..1.
  audioLow: number;
  audioHigh: number;
  // Detected main-audio onsets per band, 0..1: jumps on a hit and decays
  // quickly between hits. Audio-reactive effects scale their reactivity by
  // these rather than by the band energy.
  impulseLow: number;
  impulseHigh: number;
  // True when the source texture is bottom row first (vUv.y = 0 is the bottom
  // of the image), as for offscreen framebuffers. Layer textures are uploaded
  // top row first, so this is false for layer stacks.
  bottomUp: boolean;
};

export type EffectUniformLocations = Record<
  string,
  WebGLUniformLocation | null
>;

export type EffectPass = {
  effectName: string;
  // Fragment shader body. It samples `uTex` at `vUv`; the shared precision
  // header and fullscreen-quad vertex shader are supplied by the chain.
  fragmentSource: string;
  uniforms: string[];
  setUniforms(
    gl: WebGLRenderingContext,
    loc: EffectUniformLocations,
    params: EffectParameter[],
    ctx: EffectContext,
  ): void;
};

export function normalizeEffectKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function readEffectNumber(
  params: EffectParameter[],
  key: string,
  fallback: number,
) {
  const target = normalizeEffectKey(key);
  const parameter = params.find(
    (candidate) => normalizeEffectKey(candidate.key) === target,
  );
  if (!parameter) {
    return fallback;
  }

  const numeric =
    parameter.numericValue ?? Number.parseFloat(parameter.value ?? "");
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clampUnit(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}
