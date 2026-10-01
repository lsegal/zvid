// Text and fill clips are drawn on the CPU and uploaded as textures
// ("rasters"), which costs far more than drawing a quad. Each clip keeps the
// rasters it last drew, so a frame that draws the same content at the same
// size reuses one, compared field by field rather than through a key string
// built every frame.
//
// While a clip animates (its box resized by a Move, Transform or Order, or
// its text Size and Tracking modulated by Reactive), a frame of the playing
// preview draws from a raster close enough to stretch onto the animated box
// instead of drawing a new one every frame. Once the clip holds still, the
// next frame draws it exactly. A paused preview and export always draw
// exactly.

import type { FillPaint } from "./fill-paint.ts";
import type { FontFace } from "./text-fonts.ts";
import type { TextStyle } from "./text-style.ts";

export type RasterSize = { width: number; height: number; scale: number };

export type RasterKind<T> = {
  // Whether the two draw the same raster at the same size.
  same(a: T, b: T): boolean;
  // Whether `b` can be the next frame of `a` animating: the same but for
  // what an animation moves frame to frame.
  animates(a: T, b: T): boolean;
  // Whether a raster of `a` can stand in for `b` while `b` animates.
  near(a: T, b: T): boolean;
};

type Raster<T> = RasterSize & {
  content: T;
  // The texture in `textureMap` the raster is drawn into.
  textureId: string;
  usedAt: number;
};

// The size of the box a raster is drawn for, before it is rounded to whole
// texture pixels.
export type RasterExtent = { width: number; height: number };

type ClipRasters = {
  rasters: Raster<unknown>[];
  // What the clip's previous frame asked for.
  last?: { extent: RasterExtent; scale: number; content: unknown };
};

// A stand-in raster is stretched by at most this much either way.
const MAX_STRETCH = 1.5;

// How many rasters a clip keeps while animating in the preview, so the
// sizes a Reactive envelope passes through again are drawn once.
export const PREVIEW_RASTERS_PER_CLIP = 8;

export type RasterLookup<T> =
  | { raster: Raster<T>; exact: boolean }
  // No raster will do: draw one into `textureId` and `store` it.
  | { raster?: undefined; textureId: string };

export class RasterCache {
  private clips = new Map<string, ClipRasters>();
  private uses = 0;

  // The raster to draw `content` at `size` from, or where to draw a new
  // one. `preview` allows a stand-in while the clip is animating, which it
  // is while its content or `extent` changes from frame to frame.
  lookup<T>(
    sourceKey: string,
    kind: RasterKind<T>,
    content: T,
    size: RasterSize,
    extent: RasterExtent,
    preview: boolean,
  ): RasterLookup<T> {
    let clip = this.clips.get(sourceKey);
    if (!clip) {
      clip = { rasters: [] };
      this.clips.set(sourceKey, clip);
    }
    const rasters = clip.rasters as Raster<T>[];
    const last = clip.last as ClipRasters["last"] & { content: T };
    clip.last = { extent, scale: size.scale, content };

    const exact = rasters.find(
      (raster) => sameSize(raster, size) && kind.same(raster.content, content),
    );
    if (exact) {
      exact.usedAt = ++this.uses;
      return { raster: exact, exact: true };
    }

    // Animating: the clip changed since its last frame, in what an
    // animation moves.
    const animating =
      last !== undefined &&
      !(
        last.extent.width === extent.width &&
        last.extent.height === extent.height &&
        last.scale === size.scale &&
        kind.same(last.content, content)
      ) &&
      kind.animates(last.content, content);
    if (preview && animating) {
      const near = rasters.find(
        (raster) =>
          raster.scale === size.scale &&
          canStretch(raster.width, size.width) &&
          canStretch(raster.height, size.height) &&
          kind.animates(raster.content, content) &&
          kind.near(raster.content, content),
      );
      if (near) {
        near.usedAt = ++this.uses;
        return { raster: near, exact: false };
      }
    }

    // A raster of content the clip no longer animates from, such as text
    // since edited, is drawn over first.
    const stale = rasters.find(
      (raster) => !kind.animates(raster.content, content),
    );
    if (stale) {
      return { textureId: stale.textureId };
    }
    const capacity = preview ? PREVIEW_RASTERS_PER_CLIP : 1;
    if (rasters.length < capacity) {
      // The first raster draws into the clip's own texture, the others
      // into the first texture of theirs no raster holds.
      const textureIds = new Set(rasters.map((raster) => raster.textureId));
      let textureId = sourceKey;
      for (let slot = 1; textureIds.has(textureId); slot++) {
        textureId = `${sourceKey}#raster-${slot}`;
      }
      return { textureId };
    }
    let oldest = rasters[0];
    for (const raster of rasters) {
      if (raster.usedAt < oldest.usedAt) {
        oldest = raster;
      }
    }
    return { textureId: oldest.textureId };
  }

  // Records that `content` at `size` is now drawn into `textureId`.
  store<T>(
    sourceKey: string,
    textureId: string,
    content: T,
    size: RasterSize,
  ): Raster<T> {
    const clip = this.clips.get(sourceKey) ?? { rasters: [] };
    this.clips.set(sourceKey, clip);
    const raster: Raster<T> = {
      ...size,
      content,
      textureId,
      usedAt: ++this.uses,
    };
    const index = clip.rasters.findIndex(
      (candidate) => candidate.textureId === textureId,
    );
    if (index >= 0) {
      clip.rasters[index] = raster;
    } else {
      clip.rasters.push(raster);
    }
    return raster;
  }

  // The raster the clip used most recently, if any.
  latest(sourceKey: string) {
    let latest: Raster<unknown> | undefined;
    for (const raster of this.clips.get(sourceKey)?.rasters ?? []) {
      if (!latest || raster.usedAt > latest.usedAt) {
        latest = raster;
      }
    }
    return latest;
  }

  // Forgets the raster drawn into `textureId`, whose texture was deleted,
  // and a clip once none of its rasters are left.
  release(textureId: string) {
    for (const [sourceKey, clip] of this.clips) {
      clip.rasters = clip.rasters.filter(
        (raster) => raster.textureId !== textureId,
      );
      if (!clip.rasters.length) {
        this.clips.delete(sourceKey);
      }
    }
  }

  // How many clips have rasters.
  get size() {
    return this.clips.size;
  }

  clear() {
    this.clips.clear();
  }
}

function sameSize(a: RasterSize, b: RasterSize) {
  return a.width === b.width && a.height === b.height && a.scale === b.scale;
}

function canStretch(from: number, to: number) {
  return to <= from * MAX_STRETCH && from <= to * MAX_STRETCH;
}

// Whether two plain values (numbers, strings, arrays and objects of them)
// are equal, field by field. Top-level keys in `skip` are left out.
export function plainEqual(
  a: unknown,
  b: unknown,
  skip?: ReadonlySet<string>,
): boolean {
  if (a === b) {
    return true;
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => plainEqual(value, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key in left) {
    if (!skip?.has(key) && !plainEqual(left[key], right[key])) {
      return false;
    }
  }
  for (const key in right) {
    if (!skip?.has(key) && !(key in left) && right[key] !== undefined) {
      return false;
    }
  }
  return true;
}

// Fill opacity is applied when the raster is drawn, so only the colors and
// gradient are drawn into it.
const FILL_DRAWN_LATER = new Set(["opacity"]);

export const FILL_RASTER: RasterKind<FillPaint> = {
  same: (a, b) => plainEqual(a, b, FILL_DRAWN_LATER),
  // Only a fill's size animates.
  animates: (a, b) => plainEqual(a, b, FILL_DRAWN_LATER),
  near: () => true,
};

export type TextRaster = { style: TextStyle; face: FontFace };

// What Reactive modulates on text.
const TEXT_ANIMATED = new Set(["fontSize", "letterSpacing"]);
// While text animates, a raster this close stands in: Size in pixels at
// 1080p, Tracking in ems.
const FONT_SIZE_TOLERANCE = 2;
const LETTER_SPACING_TOLERANCE = 0.01;

export const TEXT_RASTER: RasterKind<TextRaster> = {
  same: (a, b) => plainEqual(a.face, b.face) && plainEqual(a.style, b.style),
  animates: (a, b) =>
    plainEqual(a.face, b.face) && plainEqual(a.style, b.style, TEXT_ANIMATED),
  near: (a, b) =>
    Math.abs(a.style.fontSize - b.style.fontSize) <= FONT_SIZE_TOLERANCE &&
    Math.abs(a.style.letterSpacing - b.style.letterSpacing) <=
      LETTER_SPACING_TOLERANCE,
};
