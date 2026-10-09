// The LUT effect's tables: the bundled ones and the session's `.cube`
// media, each read once, and its texture uploaded once per WebGL context.

import { isLutMedia, type MediaItem } from "../../../media.ts";
import { findEffectMedia } from "../../effect-media.ts";
import { type BundledLut, bundledLutUrl, findBundledLut } from "./bundled.ts";
import { type CubeLut, parseCubeLut } from "./cube.ts";
import { customLutMediaPath, isNoLut } from "./lut.ts";
import {
  type LutTileLayout,
  lutTexturePixels,
  lutTileLayout,
  textureCubeLut,
} from "./lut-texture.ts";

export type LutMedia = Pick<
  MediaItem,
  "id" | "name" | "sourcePath" | "previewUrl" | "availability" | "lastError"
>;

let lutMedia: readonly LutMedia[] = [];
const listeners = new Set<() => void>();
// Counts changes, as a snapshot for useSyncExternalStore.
let version = 0;

function notify() {
  version++;
  for (const listener of listeners) {
    listener();
  }
}

export function getLutMediaVersion() {
  return version;
}

/**
 * Calls `listener` when the session's LUT media change or one of them
 * finishes loading, so pickers update and a paused preview redraws.
 */
export function subscribeLutMedia(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLutMedia() {
  return lutMedia;
}

/** Keeps the session's `.cube` media, as the app has them now. */
export function setLutMedia(items: readonly MediaItem[]) {
  const next = items.filter(isLutMedia).map<LutMedia>((item) => ({
    id: item.id,
    name: item.name,
    sourcePath: item.sourcePath,
    previewUrl: item.previewUrl,
    availability: item.availability,
    lastError: item.lastError,
  }));
  const unchanged =
    next.length === lutMedia.length &&
    next.every((item, index) => {
      const previous = lutMedia[index];
      return (
        item.id === previous.id &&
        item.name === previous.name &&
        item.sourcePath === previous.sourcePath &&
        item.previewUrl === previous.previewUrl &&
        item.availability === previous.availability &&
        item.lastError === previous.lastError
      );
    });
  if (!unchanged) {
    lutMedia = next;
    notify();
  }
}

export function findLutMedia(path: string | undefined) {
  return findEffectMedia(path, lutMedia);
}

// The URL to read `item` from, while it is online.
function readyUrl(item: LutMedia | undefined) {
  return item?.availability === "ready" && item.previewUrl
    ? item.previewUrl
    : undefined;
}

type LoadedLut =
  | { status: "loading"; promise: Promise<void> }
  | { status: "ready"; lut: CubeLut }
  | { status: "failed"; message: string };

// By URL: a medium's, or a bundled LUT's file. A relinked or re-hydrated
// file has a new URL, so it loads again.
const files = new Map<string, LoadedLut>();

/** Reads and parses the `.cube` file at `url`. */
export async function readCubeLut(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The file could not be read (${response.status}).`);
  }
  return parseCubeLut(await response.text());
}

function startLoad(url: string) {
  const promise = readCubeLut(url).then(
    (lut) => {
      files.set(url, { status: "ready", lut });
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[zvid] Could not load LUT.", { url, message });
      files.set(url, { status: "failed", message });
    },
  );
  files.set(url, { status: "loading", promise: promise.then(notify) });
}

function loadedFile(url: string) {
  const entry = files.get(url);
  if (!entry) {
    startLoad(url);
    return undefined;
  }
  return entry.status === "ready" ? entry.lut : undefined;
}

type ResolvedLut = { key: string; lut: CubeLut };

// The table a stored LUT value names, with a key its texture is cached by;
// undefined for None, and while a `.cube` loads, is offline or failed.
function resolveLut(value: string | undefined): ResolvedLut | undefined {
  if (isNoLut(value)) {
    return undefined;
  }
  const path = customLutMediaPath(value);
  if (path) {
    const url = readyUrl(findLutMedia(path));
    const lut = url ? loadedFile(url) : undefined;
    return lut ? { key: `file:${url}`, lut } : undefined;
  }
  const entry = findBundledLut(value);
  if (!entry) {
    return undefined;
  }
  const url = bundledLutUrl(entry);
  const lut = loadedFile(url);
  return lut ? { key: `file:${url}`, lut } : undefined;
}

/** Whether the LUT a stored value names can grade a picture now. */
export function isLutReady(value: string | undefined) {
  return resolveLut(value) !== undefined;
}

/**
 * Why the `.cube` media a stored value names can't be used, when it was
 * read and rejected.
 */
export function getLutError(value: string | undefined) {
  const item = findLutMedia(customLutMediaPath(value));
  if (item?.lastError) {
    return item.lastError;
  }
  const url = readyUrl(item);
  const entry = url ? files.get(url) : undefined;
  return entry?.status === "failed" ? entry.message : undefined;
}

// Loads the `.cube` files at `urls`, resolving once each is ready or
// failed.
async function loadUrls(urls: Iterable<string | undefined>) {
  const pending: Promise<void>[] = [];
  for (const url of urls) {
    if (!url) {
      continue;
    }
    loadedFile(url);
    const entry = files.get(url);
    if (entry?.status === "loading") {
      pending.push(entry.promise);
    }
  }
  await Promise.all(pending);
}

/** Loads the `.cube` files `paths` name, resolving once each is ready or failed. */
export async function loadLutFiles(paths: Iterable<string>) {
  await loadUrls(Array.from(paths, (path) => readyUrl(findLutMedia(path))));
}

/** Loads the files of bundled `luts`, resolving once each is ready or failed. */
export async function loadBundledLuts(luts: Iterable<BundledLut>) {
  await loadUrls(Array.from(luts, bundledLutUrl));
}

export type BoundLut = {
  layout: LutTileLayout;
  domainMin: readonly [number, number, number];
  domainMax: readonly [number, number, number];
};

type LutTexture = BoundLut & { texture: WebGLTexture; key: string };

// Each context's LUT textures, by cache key.
const textures = new WeakMap<WebGLRenderingContext, Map<string, LutTexture>>();

/**
 * Binds the tiled texture of the LUT a stored value names to texture
 * `unit` and returns its layout and domain; undefined when there is none
 * ready. Leaves unit 0 active.
 */
export function bindLutTexture(
  gl: WebGLRenderingContext,
  value: string | undefined,
  unit: number,
): BoundLut | undefined {
  const resolved = resolveLut(value);
  if (!resolved) {
    return undefined;
  }
  let contextTextures = textures.get(gl);
  if (!contextTextures) {
    contextTextures = new Map();
    textures.set(gl, contextTextures);
  }
  let entry = contextTextures.get(resolved.key);
  gl.activeTexture(gl.TEXTURE0 + unit);
  if (!entry) {
    const texture = gl.createTexture();
    if (!texture) {
      gl.activeTexture(gl.TEXTURE0);
      return undefined;
    }
    const lut = textureCubeLut(resolved.lut);
    const layout = lutTileLayout(lut.size);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      layout.width,
      layout.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      lutTexturePixels(lut, layout),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    entry = {
      texture,
      key: resolved.key,
      layout,
      domainMin: lut.domainMin,
      domainMax: lut.domainMax,
    };
    contextTextures.set(resolved.key, entry);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
  }
  gl.activeTexture(gl.TEXTURE0);
  return entry;
}
