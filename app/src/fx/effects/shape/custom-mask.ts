// Shape ▸ Custom's masks: the session's SVG media, each SVG loaded once and
// stretched over its box, and its opaque area drawn into a mask texture at
// the size of the box it masks, so it stays crisp when scaled.

import { isImageMedia, type MediaItem } from "../../../media.ts";
import { effectMediaPath, findEffectMedia } from "../../effect-media.ts";
import { alphaToMask, stretchSvgSource } from "./custom-svg.ts";

export type ShapeImageMedia = Pick<
  MediaItem,
  "id" | "name" | "sourcePath" | "previewUrl" | "availability"
>;

let imageMedia: readonly ShapeImageMedia[] = [];
const listeners = new Set<() => void>();
// Counts changes, as a snapshot for useSyncExternalStore.
let version = 0;

function notify() {
  version++;
  for (const listener of listeners) {
    listener();
  }
}

export function getShapeImagesVersion() {
  return version;
}

/**
 * Calls `listener` when the session's SVG media change or one of them
 * finishes loading, so pickers update and a paused preview redraws.
 */
export function subscribeShapeImages(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getShapeImageMedia() {
  return imageMedia;
}

/** Keeps the session's SVG media, as the app has them now, for Custom. */
export function setShapeImageMedia(items: readonly MediaItem[]) {
  const next = items.filter(isImageMedia).map<ShapeImageMedia>((item) => ({
    id: item.id,
    name: item.name,
    sourcePath: item.sourcePath,
    previewUrl: item.previewUrl,
    availability: item.availability,
  }));
  const unchanged =
    next.length === imageMedia.length &&
    next.every((item, index) => {
      const previous = imageMedia[index];
      return (
        item.id === previous.id &&
        item.name === previous.name &&
        item.sourcePath === previous.sourcePath &&
        item.previewUrl === previous.previewUrl &&
        item.availability === previous.availability
      );
    });
  if (!unchanged) {
    imageMedia = next;
    notify();
  }
}

// The path a Custom shape stores for `item`, as a clip stores its media's.
export function shapeMediaPath(item: Pick<MediaItem, "name" | "sourcePath">) {
  return effectMediaPath(item);
}

// The media `path` names, matched the way session clips match theirs: by
// full path, else by file name.
export function findShapeMedia(
  path: string | undefined,
  items: readonly ShapeImageMedia[] = imageMedia,
) {
  return findEffectMedia(path, items);
}

// The URL to draw `item` from, while it is online.
function readyUrl(item: ShapeImageMedia | undefined) {
  return item?.availability === "ready" && item.previewUrl
    ? item.previewUrl
    : undefined;
}

type LoadedSvg =
  | { status: "loading"; promise: Promise<void> }
  | { status: "ready"; image: HTMLImageElement; url: string }
  | { status: "failed" };

// By media URL. A relinked or re-hydrated SVG has a new URL, so it loads
// again.
const svgs = new Map<string, LoadedSvg>();

async function loadStretchedSvg(url: string) {
  const response = await fetch(url);
  const source = stretchSvgSource(await response.text());
  if (!source) {
    throw new Error("Not an SVG");
  }
  const stretchedUrl = URL.createObjectURL(
    new Blob([source], { type: "image/svg+xml" }),
  );
  const image = new Image();
  image.src = stretchedUrl;
  await image.decode();
  return { image, url: stretchedUrl };
}

function startLoad(url: string) {
  const promise = loadStretchedSvg(url).then(
    ({ image, url: stretchedUrl }) => {
      svgs.set(url, { status: "ready", image, url: stretchedUrl });
    },
    () => {
      svgs.set(url, { status: "failed" });
    },
  );
  svgs.set(url, { status: "loading", promise: promise.then(notify) });
}

function loadedSvg(url: string) {
  const entry = svgs.get(url);
  if (!entry) {
    startLoad(url);
    return undefined;
  }
  return entry.status === "ready" ? entry : undefined;
}

/**
 * The stretched SVG URL for the media `path` names, for previews; undefined
 * while it loads, and when it is offline or not an SVG.
 */
export function getShapeSvgUrl(path: string | undefined) {
  const url = readyUrl(findShapeMedia(path));
  return url ? loadedSvg(url)?.url : undefined;
}

/** Whether the SVG `path` names is loaded and can mask a layer now. */
export function isShapeSvgReady(path: string | undefined) {
  const url = readyUrl(findShapeMedia(path));
  return url ? loadedSvg(url) !== undefined : false;
}

/** Loads the SVGs `paths` name, resolving once each is ready or failed. */
export async function loadShapeSvgs(paths: Iterable<string>) {
  const pending: Promise<void>[] = [];
  for (const path of paths) {
    const url = readyUrl(findShapeMedia(path));
    if (!url) {
      continue;
    }
    loadedSvg(url);
    const entry = svgs.get(url);
    if (entry?.status === "loading") {
      pending.push(entry.promise);
    }
  }
  await Promise.all(pending);
}

type MaskTexture = {
  texture: WebGLTexture;
  url: string;
  width: number;
  height: number;
};

// Each context's mask textures, by media path. A mask is redrawn only when
// its SVG or its box size changes.
const masks = new WeakMap<WebGLRenderingContext, Map<string, MaskTexture>>();
let drawCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

function drawMask(image: HTMLImageElement, width: number, height: number) {
  if (!drawCanvas) {
    drawCanvas =
      typeof OffscreenCanvas === "undefined"
        ? document.createElement("canvas")
        : new OffscreenCanvas(width, height);
  }
  drawCanvas.width = width;
  drawCanvas.height = height;
  const context = drawCanvas.getContext("2d", {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) {
    return undefined;
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return alphaToMask(context.getImageData(0, 0, width, height).data);
}

/**
 * Binds the mask of the SVG `path` names, drawn at `width` by `height`, to
 * texture `unit` and returns true; false when it isn't ready. Leaves unit 0
 * active.
 */
export function bindShapeMask(
  gl: WebGLRenderingContext,
  path: string | undefined,
  width: number,
  height: number,
  unit: number,
) {
  const url = readyUrl(findShapeMedia(path));
  const svg = url ? loadedSvg(url) : undefined;
  if (!path || !svg || width < 1 || height < 1) {
    return false;
  }
  let contextMasks = masks.get(gl);
  if (!contextMasks) {
    contextMasks = new Map();
    masks.set(gl, contextMasks);
  }
  let mask = contextMasks.get(path);
  const stale =
    !mask ||
    mask.url !== svg.url ||
    mask.width !== width ||
    mask.height !== height;
  gl.activeTexture(gl.TEXTURE0 + unit);
  if (stale) {
    const pixels = drawMask(svg.image, width, height);
    if (!pixels) {
      gl.activeTexture(gl.TEXTURE0);
      return false;
    }
    const texture = mask?.texture ?? gl.createTexture();
    if (!texture) {
      gl.activeTexture(gl.TEXTURE0);
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.ALPHA,
      width,
      height,
      0,
      gl.ALPHA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    mask = { texture, url: svg.url, width, height };
    contextMasks.set(path, mask);
  } else if (mask) {
    gl.bindTexture(gl.TEXTURE_2D, mask.texture);
  }
  gl.activeTexture(gl.TEXTURE0);
  return true;
}
