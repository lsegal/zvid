type Size = { width: number; height: number };

const surfaceAspects = new WeakMap<HTMLCanvasElement, string>();

// Sizes the preview or export canvas to the output at `pixelRatio`, keeping
// its on-screen aspect.
export function syncCanvasSurface(
  canvas: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  pixelRatio: number,
) {
  const nextWidth = Math.max(1, Math.floor(canvasWidth * pixelRatio));
  const nextHeight = Math.max(1, Math.floor(canvasHeight * pixelRatio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  // Writing the style every frame would make the browser restyle it.
  const aspect = `${canvasWidth} / ${canvasHeight}`;
  if (surfaceAspects.get(canvas) !== aspect) {
    surfaceAspects.set(canvas, aspect);
    canvas.style.aspectRatio = aspect;
  }
}

// The preview's pixel ratio to the output: enough for the device pixels it
// covers when letterboxed into `panel`, but never more than the output
// itself. A panel that has not been laid out yet previews at output size.
export function resolvePreviewPixelRatio(
  output: Size,
  panel: Size,
  devicePixelRatio: number,
) {
  if (
    output.width <= 0 ||
    output.height <= 0 ||
    panel.width <= 0 ||
    panel.height <= 0
  ) {
    return 1;
  }

  const fit = Math.min(
    panel.width / output.width,
    panel.height / output.height,
  );
  const deviceRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.min(1, fit * deviceRatio);
}
