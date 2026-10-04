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

export const PREVIEW_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  ...EXPORT_CONTEXT_ATTRIBUTES,
};
