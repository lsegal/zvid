// The cover-art thumbnail embedded in exported MP4s. File browsers such as
// Windows Explorer show it without decoding the HEVC/AV1 video.

export const THUMBNAIL_MAX_EDGE = 640;
const THUMBNAIL_JPEG_QUALITY = 0.85;

/** The frame about one second in, or the middle frame of shorter exports. */
export function getThumbnailFrameIndex(
  frameCount: number,
  frameRate: number,
): number {
  if (frameCount <= 0) return 0;
  return Math.max(
    0,
    Math.min(Math.round(frameRate), Math.floor(frameCount / 2)),
  );
}

/** Scales the output size down to at most 640 px on the long edge. */
export function getThumbnailSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Copies the canvas into a scaled thumbnail. Call it right after rendering
 * the frame: a WebGL canvas without `preserveDrawingBuffer` is cleared once
 * the browser composites it.
 */
export function drawThumbnail(source: HTMLCanvasElement): HTMLCanvasElement {
  const size = getThumbnailSize(source.width, source.height);
  const thumbnail = document.createElement("canvas");
  thumbnail.width = size.width;
  thumbnail.height = size.height;
  const context = thumbnail.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  // JPEG has no alpha; match the black the video encoder shows.
  context.fillStyle = "black";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(source, 0, 0, size.width, size.height);
  return thumbnail;
}

export async function encodeThumbnail(
  thumbnail: HTMLCanvasElement,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    thumbnail.toBlob(resolve, "image/jpeg", THUMBNAIL_JPEG_QUALITY),
  );
  if (!blob?.size) throw new Error("Cannot encode the export thumbnail.");
  return new Uint8Array(await blob.arrayBuffer());
}
