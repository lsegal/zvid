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

  canvas.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
}
