import { type FillPaint, rasterizeFillPaint } from "./fill-paint.ts";
import { isFontFaceReady, resolveFontFace } from "./text-fonts.ts";
import { createTextCanvas, drawText } from "./text-render.ts";
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

// What a video texture's storage was allocated at, and the frame it holds
// (null when unknown, so the next draw uploads).
type VideoUpload = { width: number; height: number; frame: string | null };

// The texture each media, fill or text source is drawn from.
export type SourceTextures = {
  gl: WebGLRenderingContext;
  textureMap: Map<string, WebGLTexture>;
  readyTextureIds: Set<string>;
  // What each fill or text texture was last drawn with, so it is only
  // redrawn when its paint, text or size changes.
  generatedTextureKeys: Map<string, string>;
  // Compositions drawn, and the one each texture was last used in.
  drawCount: number;
  textureLastDrawn: Map<string, number>;
  videoUploads: Map<string, VideoUpload>;
};

export function createSourceTextures(gl: WebGLRenderingContext) {
  return {
    gl,
    textureMap: new Map<string, WebGLTexture>(),
    readyTextureIds: new Set<string>(),
    generatedTextureKeys: new Map<string, string>(),
    drawCount: 0,
    textureLastDrawn: new Map<string, number>(),
    videoUploads: new Map<string, VideoUpload>(),
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
  textures.generatedTextureKeys.delete(id);
  textures.textureLastDrawn.delete(id);
  textures.videoUploads.delete(id);
}

export function releaseAllTextures(textures: SourceTextures) {
  for (const texture of textures.textureMap.values()) {
    textures.gl.deleteTexture(texture);
  }
  textures.textureMap.clear();
  textures.readyTextureIds.clear();
  textures.generatedTextureKeys.clear();
  textures.textureLastDrawn.clear();
  textures.videoUploads.clear();
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

// Names the frame `element` shows. While it plays, its frame callbacks
// count each new frame, so a draw between two frames names the same one;
// paused, or without callbacks, its time does. The count also catches a
// frame presented late after a seek.
function presentedFrameId(element: HTMLVideoElement) {
  const watched = watchPresentedFrames(element);
  const source = element.currentSrc || element.src;
  if (
    !element.paused &&
    performance.now() - watched.at < FRAME_CALLBACK_STALE_MS
  ) {
    return `${source}#${watched.count}`;
  }
  return `${source}@${element.currentTime}#${watched.count}`;
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
    upload = { width: 0, height: 0, frame: null };
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

  const frame = presentedFrameId(mediaElement);
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
    upload.frame = null;
  } else if (upload.frame === frame) {
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
  upload.frame = mediaElement.seeking ? null : frame;
  return texture;
}

// Draws a fill's paint into its texture, top row first like an uploaded
// video frame, when the paint or the band size changed since last time.
export function uploadFillTexture(
  textures: SourceTextures,
  sourceKey: string,
  fill: FillPaint,
  bandWidth: number,
  bandHeight: number,
) {
  const { gl } = textures;
  const texture = getOrCreateTexture(textures, sourceKey);
  const scale = Math.min(
    1,
    MAX_FILL_TEXTURE_SIZE / Math.max(bandWidth, bandHeight, 1),
  );
  const textureWidth = Math.max(1, Math.round(bandWidth * scale));
  const textureHeight = Math.max(1, Math.round(bandHeight * scale));
  const key = `${textureWidth}x${textureHeight}:${JSON.stringify(fill)}`;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (textures.generatedTextureKeys.get(sourceKey) !== key) {
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
    textures.generatedTextureKeys.set(sourceKey, key);
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
  textures: SourceTextures,
  sourceKey: string,
  text: TextStyle,
  boxWidth: number,
  boxHeight: number,
  boxScale: number,
) {
  const { gl } = textures;
  const face = resolveFontFace(text.font, text.weight, text.italic);
  // A box too large for a texture is drawn smaller, laid out the same.
  const { width, height, factor } = fitTextureSize(gl, boxWidth, boxHeight);
  const scale = boxScale * factor;
  const key = `${width}x${height}@${scale}:${JSON.stringify(face)}:${JSON.stringify(text)}`;
  const drawn = textures.generatedTextureKeys.get(sourceKey);
  if (drawn !== key && !isFontFaceReady(face)) {
    return drawn === undefined
      ? undefined
      : getOrCreateTexture(textures, sourceKey);
  }

  const texture = getOrCreateTexture(textures, sourceKey);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (drawn !== key) {
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
    textures.generatedTextureKeys.set(sourceKey, key);
  }
  return texture;
}
