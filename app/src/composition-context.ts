// WebGL context attributes for the compositor's canvases. Export keeps its
// own so a preview-only setting never changes what an export produces:
// `antialias` smooths the edges of rotated and transformed layers, and the
// last Global-chain pass can leave alpha below 1, which `alpha` and
// `premultipliedAlpha` decide how to show.
export const EXPORT_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: true,
  premultipliedAlpha: false,
};

// `alpha: false`, `premultipliedAlpha: true` and `antialias: false` each
// measured within noise of these in Chromium and WebKit playback (#991), so
// the preview keeps export's attributes until one shows a real gain.
export const PREVIEW_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  ...EXPORT_CONTEXT_ATTRIBUTES,
};
