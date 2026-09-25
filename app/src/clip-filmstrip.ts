// Lays out the filmstrip drawn across a layer clip or source span: a row of thumbnail tiles,
// each showing the source frame under its left edge. Only tiles inside the
// visible timeline range are laid out, and sample times are snapped to a
// zoom-dependent grid so small zoom changes reuse frames already decoded.
import { getClipThumbnailTimeSeconds } from "./thumbnail-cache.ts";

export type FilmstripTile = {
  index: number;
  // Offset and width within the clip, in pixels. The last tile is cut off at
  // the clip's end.
  leftPx: number;
  widthPx: number;
  timeSeconds: number;
};

export type FilmstripRange = { startPx: number; endPx: number };

export type FilmstripClip = {
  trimStartSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
};

export type FilmstripLayout = {
  clip: FilmstripClip;
  mediaDurationSeconds: number;
  // Where the clip sits on the timeline, in pixels.
  clipLeftPx: number;
  clipWidthPx: number;
  tileWidthPx: number;
  // How much source time one timeline pixel covers.
  secondsPerPx: number;
  range: FilmstripRange;
};

const DEFAULT_ASPECT = 16 / 9;
const MIN_TILE_WIDTH_PX = 24;
const MAX_TILE_WIDTH_PX = 96;
// Sample times never get finer than one frame at 30 fps.
const MIN_SAMPLE_STEP_SECONDS = 1 / 30;
// The visible range is widened and snapped to this many pixels, so scrolling
// only changes the tiles wanted when it crosses a block, and tiles just off
// screen are ready when they scroll in.
const RANGE_BLOCK_PX = 512;
// Absorbs rounding error so a time just below a grid line snaps onto it.
const GRID_EPSILON = 1e-6;

// A tile is as tall as the clip and as wide as the source's aspect allows.
export function getFilmstripTileWidthPx(
  heightPx: number,
  mediaWidth?: number,
  mediaHeight?: number,
) {
  const aspect =
    mediaWidth && mediaHeight && mediaWidth > 0 && mediaHeight > 0
      ? mediaWidth / mediaHeight
      : DEFAULT_ASPECT;
  return Math.min(
    MAX_TILE_WIDTH_PX,
    Math.max(MIN_TILE_WIDTH_PX, Math.round(heightPx * aspect)),
  );
}

// A source span plays its media from its start for its whole duration, so
// its tiles sample that stretch of the source.
export function getSourceSpanFilmstripClip(span: {
  trimStartSeconds: number;
  durationSeconds: number;
}): FilmstripClip {
  return {
    trimStartSeconds: span.trimStartSeconds,
    sourceWindowStartSeconds: span.trimStartSeconds,
    sourceWindowEndSeconds:
      span.trimStartSeconds + Math.max(0, span.durationSeconds),
  };
}

// The visible timeline range plus a block either side, snapped to blocks.
export function getFilmstripRange(
  visibleStartPx: number,
  visibleWidthPx: number,
): FilmstripRange {
  if (visibleWidthPx <= 0) {
    return { startPx: 0, endPx: 0 };
  }

  const startBlock = Math.floor(visibleStartPx / RANGE_BLOCK_PX) - 1;
  const endBlock =
    Math.ceil((visibleStartPx + visibleWidthPx) / RANGE_BLOCK_PX) + 1;
  return {
    startPx: Math.max(0, startBlock * RANGE_BLOCK_PX),
    endPx: endBlock * RANGE_BLOCK_PX,
  };
}

// The largest power-of-two number of seconds no longer than one tile, so
// sample times stay on the same grid until the zoom changes by a factor of 2.
export function getFilmstripSampleStepSeconds(secondsPerTile: number) {
  if (!(secondsPerTile > MIN_SAMPLE_STEP_SECONDS)) {
    return MIN_SAMPLE_STEP_SECONDS;
  }

  return Math.max(
    MIN_SAMPLE_STEP_SECONDS,
    2 ** Math.floor(Math.log2(secondsPerTile)),
  );
}

export function getClipFilmstripTiles({
  clip,
  mediaDurationSeconds,
  clipLeftPx,
  clipWidthPx,
  tileWidthPx,
  secondsPerPx,
  range,
}: FilmstripLayout): FilmstripTile[] {
  if (clipWidthPx <= 0 || tileWidthPx <= 0 || range.endPx <= range.startPx) {
    return [];
  }

  const tileCount = Math.ceil(clipWidthPx / tileWidthPx);
  const first = Math.max(
    0,
    Math.floor((range.startPx - clipLeftPx) / tileWidthPx),
  );
  const last = Math.min(
    tileCount - 1,
    Math.ceil((range.endPx - clipLeftPx) / tileWidthPx) - 1,
  );
  const step = getFilmstripSampleStepSeconds(tileWidthPx * secondsPerPx);
  const tiles: FilmstripTile[] = [];
  for (let index = first; index <= last; index += 1) {
    const leftPx = index * tileWidthPx;
    const widthPx = Math.min(tileWidthPx, clipWidthPx - leftPx);
    // The first tile shows the clip's first frame, the same one as its
    // first-frame thumbnail. Later tiles snap down to the grid, which keeps
    // them at or after the in-point since a tile covers at least one step.
    const edgeSeconds = clip.trimStartSeconds + leftPx * secondsPerPx;
    const sampleSeconds =
      index === 0
        ? clip.trimStartSeconds
        : Math.floor(edgeSeconds / step + GRID_EPSILON) * step;
    tiles.push({
      index,
      leftPx,
      widthPx,
      timeSeconds: getClipThumbnailTimeSeconds(
        { ...clip, trimStartSeconds: sampleSeconds },
        mediaDurationSeconds,
      ),
    });
  }
  return tiles;
}
