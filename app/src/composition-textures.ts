import type {
  CompositeLayer,
  FrameContext,
  WebGlResources,
} from "./composition-draw.ts";
import {
  FILL_RASTER,
  type RasterExtent,
  type RasterKind,
  type RasterSize,
  TEXT_RASTER,
} from "./composition-raster-cache.ts";
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

// The texture `content` is drawn into at `size`: a raster the clip already
// drew, or a new one `draw` uploads into the bound texture. Returns
// undefined when nothing is drawn yet; `settled` is false when a nearby
// raster stands in for an animating clip, which a later frame draws exactly.
function generatedTexture<T>(
  resources: WebGlResources,
  sourceKey: string,
  kind: RasterKind<T>,
  content: T,
  size: RasterSize,
  extent: RasterExtent,
  frameContext: FrameContext,
  draw: (() => boolean) | undefined,
) {
  const { gl } = resources;
  const found = resources.rasters.lookup(
    sourceKey,
    kind,
    content,
    size,
    extent,
    Boolean(frameContext.preview),
  );
  if (found.raster) {
    const texture = getOrCreateTexture(resources, found.raster.textureId);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    return { texture, settled: found.exact };
  }
  if (!draw) {
    // It can't be drawn yet: keep showing what it last drew. It is redrawn
    // when it can be, such as when its font loads.
    const latest = resources.rasters.latest(sourceKey);
    return (
      latest && {
        texture: getOrCreateTexture(resources, latest.textureId),
        settled: true,
      }
    );
  }
  const { textureId } = found;
  const texture = getOrCreateTexture(resources, textureId);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (!draw()) {
    return undefined;
  }
  resources.rasters.store(sourceKey, textureId, content, size);
  return { texture, settled: true };
}

// Draws a fill's colors into its texture, top row first like an uploaded
// video frame, when they or the band size changed since last time. A solid
// fill is the same at any size, so it is one pixel. Its opacity is applied
// when it is drawn.
export function uploadFillTexture(
  resources: WebGlResources,
  sourceKey: string,
  fill: FillPaint,
  bandWidth: number,
  bandHeight: number,
  frameContext: FrameContext,
) {
  const { gl } = resources;
  const scale =
    fill.kind === "solid"
      ? 0
      : Math.min(1, MAX_FILL_TEXTURE_SIZE / Math.max(bandWidth, bandHeight, 1));
  const size = {
    width: Math.max(1, Math.round(bandWidth * scale)),
    height: Math.max(1, Math.round(bandHeight * scale)),
    scale: 1,
  };
  return generatedTexture(
    resources,
    sourceKey,
    FILL_RASTER,
    fill,
    size,
    { width: bandWidth, height: bandHeight },
    frameContext,
    () => {
      renderStats.fillRasterizations++;
      const raster = rasterizeFillPaint(
        { ...fill, opacity: 1 },
        size.width,
        size.height,
      );
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
      return true;
    },
  );
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
  frameContext: FrameContext,
) {
  const { gl } = resources;
  const face = resolveFontFace(text.font, text.weight, text.italic);
  // A box too large for a texture is drawn smaller, laid out the same.
  const { width, height, factor } = fitTextureSize(gl, boxWidth, boxHeight);
  const scale = boxScale * factor;
  return generatedTexture(
    resources,
    sourceKey,
    TEXT_RASTER,
    { style: text, face },
    { width, height, scale },
    { width: boxWidth, height: boxHeight },
    frameContext,
    isFontFaceReady(face)
      ? () => {
          renderStats.textRasterizations++;
          const canvas = createTextCanvas(width, height);
          if (!canvas || !drawText(canvas, text, face, width, height, scale)) {
            return false;
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
          return true;
        }
      : undefined,
  );
}
