import type { CompositeLayer, WebGlResources } from "./composition-draw.ts";
import { type FillPaint, rasterizeFillPaint } from "./fill-paint.ts";
import { renderStats } from "./render-stats.ts";
import { isFontFaceReady, resolveFontFace } from "./text-fonts.ts";
import { createTextCanvas, drawText } from "./text-render.ts";
import type { TextStyle } from "./text-style.ts";

// Fill textures are drawn at most this many pixels on a side; the linear
// filter smooths gradients when the band is larger.
const MAX_FILL_TEXTURE_SIZE = 512;

export function getOrCreateTexture(resources: WebGlResources, id: string) {
  const existing = resources.textureMap.get(id);
  if (existing) {
    return existing;
  }

  const { gl } = resources;
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error("Failed to allocate WebGL texture.");
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  resources.textureMap.set(id, texture);
  return texture;
}

// Uploads the media element's current frame into the layer's texture.
// Returns undefined when the element has never had a frame to show.
export function uploadVideoTexture(
  resources: WebGlResources,
  entry: CompositeLayer,
  mediaElement: HTMLVideoElement,
) {
  const { gl } = resources;
  const texture = getOrCreateTexture(resources, entry.sourceKey);
  const hasDecodedFrame =
    mediaElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    (mediaElement.videoWidth > 0 || Boolean(entry.media.width)) &&
    (mediaElement.videoHeight > 0 || Boolean(entry.media.height));

  if (hasDecodedFrame) {
    resources.readyTextureIds.add(entry.sourceKey);
  } else if (!resources.readyTextureIds.has(entry.sourceKey)) {
    return undefined;
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (hasDecodedFrame) {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      mediaElement,
    );
  }
  return texture;
}

// Draws a fill's paint into its texture, top row first like an uploaded
// video frame, when the paint or the band size changed since last time.
export function uploadFillTexture(
  resources: WebGlResources,
  sourceKey: string,
  fill: FillPaint,
  bandWidth: number,
  bandHeight: number,
) {
  const { gl } = resources;
  const texture = getOrCreateTexture(resources, sourceKey);
  const scale = Math.min(
    1,
    MAX_FILL_TEXTURE_SIZE / Math.max(bandWidth, bandHeight, 1),
  );
  const textureWidth = Math.max(1, Math.round(bandWidth * scale));
  const textureHeight = Math.max(1, Math.round(bandHeight * scale));
  const key = `${textureWidth}x${textureHeight}:${JSON.stringify(fill)}`;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (resources.generatedTextureKeys.get(sourceKey) !== key) {
    renderStats.fillRasterizations++;
    const raster = rasterizeFillPaint(fill, textureWidth, textureHeight);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      raster.width,
      raster.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      raster.pixels,
    );
    resources.generatedTextureKeys.set(sourceKey, key);
  }
  return texture;
}

// A texture size for a `width` × `height` box: whole pixels, shrunk by
// `factor` to fit the largest texture the context allows.
export function fitTextureSize(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
) {
  const maxSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
  const factor = Math.min(1, maxSize / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.min(maxSize, Math.round(width * factor))),
    height: Math.max(1, Math.min(maxSize, Math.round(height * factor))),
    factor,
  };
}

// Draws a text clip into its texture at the full size of its box, so it
// stays sharp, when its text, style, face or the box changed since last
// time. Until its face has loaded, the previous texture is kept, or nothing
// is drawn, so the text never shows in a fallback font.
export function uploadTextTexture(
  resources: WebGlResources,
  sourceKey: string,
  text: TextStyle,
  boxWidth: number,
  boxHeight: number,
  boxScale: number,
) {
  const { gl } = resources;
  const face = resolveFontFace(text.font, text.weight, text.italic);
  // A box too large for a texture is drawn smaller, laid out the same.
  const { width, height, factor } = fitTextureSize(gl, boxWidth, boxHeight);
  const scale = boxScale * factor;
  const key = `${width}x${height}@${scale}:${JSON.stringify(face)}:${JSON.stringify(text)}`;
  const drawn = resources.generatedTextureKeys.get(sourceKey);
  if (drawn !== key && !isFontFaceReady(face)) {
    return drawn === undefined
      ? undefined
      : getOrCreateTexture(resources, sourceKey);
  }

  const texture = getOrCreateTexture(resources, sourceKey);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (drawn !== key) {
    renderStats.textRasterizations++;
    const canvas = createTextCanvas(width, height);
    if (!canvas || !drawText(canvas, text, face, width, height, scale)) {
      return undefined;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas as TexImageSource,
    );
    resources.generatedTextureKeys.set(sourceKey, key);
  }
  return texture;
}
