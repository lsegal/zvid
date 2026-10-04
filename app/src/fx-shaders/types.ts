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
  // No main-audio fields: passes never read the music. It moves an effect
  // only through its Animation modifier's Reactive mode, which changes the
  // parameters the pass is given (see fx-animation.ts).
  // True when the source texture is bottom row first (vUv.y = 0 is the bottom
  // of the image), as for offscreen framebuffers. Layer textures are uploaded
  // top row first, so this is false for layer stacks.
  bottomUp: boolean;
};

export type EffectUniformLocations = Record<
  string,
  WebGLUniformLocation | null
>;

// A picture a pass draws before its main shader, at a fraction of the
// picture's size, such as a blurred copy to build a glow from. The stages
// after it and the main shader read it through a sampler uniform named
// `name`.
export type EffectStage = {
  name: string;
  // Fragment shader body, as for EffectPass. It may sample `uTex` and the
  // earlier stages' samplers, all at `vUv`.
  fragmentSource: string;
  uniforms: string[];
  // `ctx.resolution` is the stage's own size.
  setUniforms(
    gl: WebGLRenderingContext,
    loc: EffectUniformLocations,
    params: EffectParameter[],
    ctx: EffectContext,
  ): void;
};

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
  // Drawn in order before the main shader, each `stageScale` of the
  // picture's size on each side (see `stageSize`). A scale of 0 skips them,
  // and the main shader must then not read them.
  stages?: EffectStage[];
  stageScale?(params: EffectParameter[], ctx: EffectContext): number;
};

// A stage's side, for a picture side `size` pixels long.
export function stageSize(size: number, scale: number) {
  return Math.max(1, Math.round(size * scale));
}

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
