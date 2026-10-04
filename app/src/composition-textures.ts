import {
  FILL_RASTER,
  RasterCache,
  type RasterExtent,
  type RasterKind,
  type RasterSize,
  TEXT_RASTER,
} from "./composition-raster-cache.ts";
import { type FillPaint, rasterizeFillPaint } from "./fill-paint.ts";
import { renderStats } from "./render-stats.ts";
import { isFontFaceReady, resolveFontFace } from "./text-fonts.ts";
import { createTextCanvas, drawText, type TextCanvas } from "./text-render.ts";
import type { TextStyle } from "./text-style.ts";

// Fill textures are drawn at most this many pixels on a side; the linear
// filter smooths gradients when the band is larger.
const MAX_FILL_TEXTURE_SIZE = 512;

// A source's texture is deleted once this many compositions have been drawn
// without it, so hiding a clip for a moment doesn't redraw its texture.
export const TEXTURE_GRACE_DRAWS = 120;

// While playing, a video's frame callbacks name each new frame. When they
// have not run for this long, its time names the frame instead.
const FRAME_CALLBACK_STALE_MS = 200;

// What a video texture's storage was allocated at, and the frame it holds:
// the element's source (null when unknown, so the next draw uploads), its
// presented-frame count, and its time, or -1 while frame callbacks name
// the frame instead.
type VideoUpload = {
  width: number;
  height: number;
  source: string | null;
  count: number;
  time: number;
};

// The texture each media, fill or text source is drawn from.
export type SourceTextures = {
  gl: WebGLRenderingContext;
  textureMap: Map<string, WebGLTexture>;
  readyTextureIds: Set<string>;
  // The rasters each fill or text source has drawn, so it is only redrawn
  // when its paint, text or size changes.
  rasters: RasterCache;
  // Compositions drawn, and the one each texture was last used in.
  drawCount: number;
  textureLastDrawn: Map<string, number>;
  videoUploads: Map<string, VideoUpload>;
  // The size each text raster's texture storage was allocated at, so a
  // redraw at the same size writes into it rather than reallocating.
  textStorage: Map<string, { width: number; height: number }>;
  // The canvas text is drawn into before it is uploaded, reused across
  // redraws and resized only when the box changes.
  textCanvas: TextCanvas | undefined;
};

export function createSourceTextures(gl: WebGLRenderingContext) {
  return {
    gl,
    textureMap: new Map<string, WebGLTexture>(),
    readyTextureIds: new Set<string>(),
    rasters: new RasterCache(),
    drawCount: 0,
    textureLastDrawn: new Map<string, number>(),
    videoUploads: new Map<string, VideoUpload>(),
    textStorage: new Map<string, { width: number; height: number }>(),
    textCanvas: undefined as TextCanvas | undefined,
  };
}

function getOrCreateTexture(textures: SourceTextures, id: string) {
  textures.textureLastDrawn.set(id, textures.drawCount);
  const existing = textures.textureMap.get(id);
  if (existing) {
    return existing;
  }

  const { gl } = textures;
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error("Failed to allocate WebGL texture.");
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  textures.textureMap.set(id, texture);
  return texture;
}

// Deletes a source's texture and everything known about what it holds.
export function releaseTexture(textures: SourceTextures, id: string) {
  const texture = textures.textureMap.get(id);
  if (texture) {
    textures.gl.deleteTexture(texture);
  }
  textures.textureMap.delete(id);
  textures.readyTextureIds.delete(id);
  textures.rasters.release(id);
  textures.textureLastDrawn.delete(id);
  textures.videoUploads.delete(id);
  textures.textStorage.delete(id);
}

export function releaseAllTextures(textures: SourceTextures) {
  for (const texture of textures.textureMap.values()) {
    textures.gl.deleteTexture(texture);
  }
  textures.textureMap.clear();
  textures.readyTextureIds.clear();
  textures.rasters.clear();
  textures.textureLastDrawn.clear();
  textures.videoUploads.clear();
  textures.textStorage.clear();
  textures.textCanvas = undefined;
}

// Starts drawing a composition: deletes the textures of videos no longer in
// `mediaRefs` and of sources not drawn in the last `graceDraws` draws.
export function beginTextureDraw(
  textures: SourceTextures,
  mediaRefs: Map<string, HTMLMediaElement>,
  graceDraws = TEXTURE_GRACE_DRAWS,
) {
  textures.drawCount += 1;
  for (const id of textures.videoUploads.keys()) {
    if (!mediaRefs.has(id)) {
      releaseTexture(textures, id);
    }
  }
  for (const [id, drawn] of textures.textureLastDrawn) {
    if (textures.drawCount - drawn > graceDraws) {
      releaseTexture(textures, id);
    }
  }
}

// How many frames each video has presented, and when it last did, from its
// frame callbacks.
type PresentedFrames = { count: number; at: number };
const presentedFrames = new WeakMap<HTMLVideoElement, PresentedFrames>();

function watchPresentedFrames(element: HTMLVideoElement) {
  const known = presentedFrames.get(element);
  if (known) {
    return known;
  }
  const watched: PresentedFrames = {
    count: -1,
    at: Number.NEGATIVE_INFINITY,
  };
  presentedFrames.set(element, watched);
  if (typeof element.requestVideoFrameCallback === "function") {
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      watched.count = metadata.presentedFrames;
      watched.at = performance.now();
      element.requestVideoFrameCallback(onFrame);
    };
    element.requestVideoFrameCallback(onFrame);
  }
  return watched;
}

// The time that, with its source and presented-frame count, names the
// frame `element` shows: -1 while it plays, as its frame callbacks count
// each new frame and a draw between two frames names the same one; its
// time when paused or without callbacks. The count also catches a frame
// presented late after a seek. These are compared field by field, so no
// name is built each draw.
function presentedFrameTime(
  element: HTMLVideoElement,
  watched: PresentedFrames,
) {
  return !element.paused &&
    performance.now() - watched.at < FRAME_CALLBACK_STALE_MS
    ? -1
    : element.currentTime;
}

// Uploads the media element's current frame into the source's texture,
// unless it already holds that frame. Storage is allocated once per video
// size and each frame written into it. Returns undefined when the element
// has never had a frame to show.
export function uploadVideoTexture(
  textures: SourceTextures,
  sourceKey: string,
  media: { width?: number; height?: number },
  mediaElement: HTMLVideoElement,
) {
  const { gl } = textures;
  const texture = getOrCreateTexture(textures, sourceKey);
  let upload = textures.videoUploads.get(sourceKey);
  if (!upload) {
    upload = { width: 0, height: 0, source: null, count: 0, time: 0 };
    textures.videoUploads.set(sourceKey, upload);
  }
  const hasDecodedFrame =
    mediaElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    (mediaElement.videoWidth > 0 || Boolean(media.width)) &&
    (mediaElement.videoHeight > 0 || Boolean(media.height));

  if (hasDecodedFrame) {
    textures.readyTextureIds.add(sourceKey);
  } else if (!textures.readyTextureIds.has(sourceKey)) {
    return undefined;
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (!hasDecodedFrame) {
    return texture;
  }

  const watched = watchPresentedFrames(mediaElement);
  const source = mediaElement.currentSrc || mediaElement.src;
  const time = presentedFrameTime(mediaElement, watched);
  const { videoWidth: width, videoHeight: height } = mediaElement;
  if (upload.width !== width || upload.height !== height) {
    if (width > 0 && height > 0) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    upload.width = width;
    upload.height = height;
    upload.source = null;
  } else if (
    upload.source === source &&
    upload.count === watched.count &&
    upload.time === time
  ) {
    return texture;
  }

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  if (width > 0 && height > 0) {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      mediaElement,
    );
  } else {
    // Without a known size the frame sets the storage's size itself.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      mediaElement,
    );
  }
  // Mid-seek the element may still show the frame it is leaving.
  upload.source = mediaElement.seeking ? null : source;
  upload.count = watched.count;
  upload.time = time;
  return texture;
}

// The texture `content` is drawn into at `size`: a raster the source
// already drew, or a new one `draw` uploads into the bound texture. Returns
// undefined when nothing is drawn yet; `settled` is false when a nearby
// raster stands in for an animating source, which a later frame draws
// exactly.
function generatedTexture<T>(
  textures: SourceTextures,
  sourceKey: string,
  kind: RasterKind<T>,
  content: T,
  size: RasterSize,
  extent: RasterExtent,
  preview: boolean,
  draw: ((textureId: string) => boolean) | undefined,
) {
  const { gl } = textures;
  const found = textures.rasters.lookup(
    sourceKey,
    kind,
    content,
    size,
    extent,
    preview,
  );
  if (found.raster) {
    const texture = getOrCreateTexture(textures, found.raster.textureId);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    return { texture, settled: found.exact };
  }
  if (!draw) {
    // It can't be drawn yet: keep showing what it last drew. It is redrawn
    // when it can be, such as when its font loads.
    const latest = textures.rasters.latest(sourceKey);
    return (
      latest && {
        texture: getOrCreateTexture(textures, latest.textureId),
        settled: true,
      }
    );
  }
  const { textureId } = found;
  const texture = getOrCreateTexture(textures, textureId);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (!draw(textureId)) {
    return undefined;
  }
  textures.rasters.store(sourceKey, textureId, content, size);
  return { texture, settled: true };
}

// Draws a fill's colors into its texture, top row first like an uploaded
// video frame, when they or the band size changed since last time. A solid
// fill is the same at any size, so it is one pixel. Its opacity is applied
// when it is drawn.
export function uploadFillTexture(
  textures: SourceTextures,
  sourceKey: string,
  fill: FillPaint,
  bandWidth: number,
  bandHeight: number,
  { preview }: { preview?: boolean },
) {
  const { gl } = textures;
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
    textures,
    sourceKey,
    FILL_RASTER,
    fill,
    size,
    { width: bandWidth, height: bandHeight },
    Boolean(preview),
    (textureId) => {
      renderStats.fillRasterizations++;
      textures.textStorage.delete(textureId);
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

// Each context's largest texture size, read once: getParameter is a
// synchronous driver query, and this runs per text clip every frame.
const maxTextureSizes = new WeakMap<WebGLRenderingContext, number>();

function maxTextureSize(gl: WebGLRenderingContext) {
  let size = maxTextureSizes.get(gl);
  if (size === undefined) {
    size = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
    maxTextureSizes.set(gl, size);
  }
  return size;
}

// A texture size for a `width` × `height` box: whole pixels, shrunk by
// `factor` to fit the largest texture the context allows.
export function fitTextureSize(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
) {
  const maxSize = maxTextureSize(gl);
  const factor = Math.min(1, maxSize / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.min(maxSize, Math.round(width * factor))),
    height: Math.max(1, Math.min(maxSize, Math.round(height * factor))),
    factor,
  };
}

// The scratch canvas text is drawn into, at `width` × `height`. Its 2D
// state needs no reset: drawText clears it and sets everything it uses.
function textCanvas(textures: SourceTextures, width: number, height: number) {
  const canvas = textures.textCanvas;
  if (!canvas) {
    textures.textCanvas = createTextCanvas(width, height);
    return textures.textCanvas;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas;
}

// Draws a text clip into its texture at the full size of its box, so it
// stays sharp, when its text, style, face or the box changed since last
// time. Until its face has loaded, the previous texture is kept, or nothing
// is drawn, so the text never shows in a fallback font.
export function uploadTextTexture(
  textures: SourceTextures,
  sourceKey: string,
  text: TextStyle,
  boxWidth: number,
  boxHeight: number,
  boxScale: number,
  { preview }: { preview?: boolean },
) {
  const { gl } = textures;
  const face = resolveFontFace(text.font, text.weight, text.italic);
  // A box too large for a texture is drawn smaller, laid out the same.
  const { width, height, factor } = fitTextureSize(gl, boxWidth, boxHeight);
  const scale = boxScale * factor;
  return generatedTexture(
    textures,
    sourceKey,
    TEXT_RASTER,
    { style: text, face },
    { width, height, scale },
    { width: boxWidth, height: boxHeight },
    Boolean(preview),
    isFontFaceReady(face)
      ? (textureId) => {
          renderStats.textRasterizations++;
          const canvas = textCanvas(textures, width, height);
          if (!canvas || !drawText(canvas, text, face, width, height, scale)) {
            return false;
          }
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
          const storage = textures.textStorage.get(textureId);
          if (storage?.width === width && storage.height === height) {
            gl.texSubImage2D(
              gl.TEXTURE_2D,
              0,
              0,
              0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              canvas as TexImageSource,
            );
          } else {
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              canvas as TexImageSource,
            );
            textures.textStorage.set(textureId, { width, height });
          }
          return true;
        }
      : undefined,
  );
}
