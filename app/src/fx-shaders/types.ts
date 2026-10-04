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

// Effect names and parameter keys come from a small set and are normalized
// for every effect at every frame, so each is normalized once.
const MAX_NORMALIZED_KEYS = 4096;
const normalizedKeys = new Map<string, string>();

export function normalizeEffectKey(key: string) {
  let normalized = normalizedKeys.get(key);
  if (normalized === undefined) {
    normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.size >= MAX_NORMALIZED_KEYS) {
      normalizedKeys.clear();
    }
    normalizedKeys.set(key, normalized);
  }
  return normalized;
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
