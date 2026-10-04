import type { FilmstripTile } from "../clip-filmstrip.ts";
import type { MediaItem } from "../media.ts";
import type { ThumbnailSize } from "../thumbnail-cache.ts";

// The inner heights of a clip card and a source span, which filmstrip tiles
// fill.
export const CLIP_FILMSTRIP_HEIGHT_PX = 42;

export const SOURCE_SPAN_FILMSTRIP_HEIGHT_PX = 54;

// `size` is the pixel size every frame of the filmstrip is decoded at.
export type Filmstrip = {
  media: MediaItem;
  size: ThumbnailSize;
  tiles: FilmstripTile[];
};

export function getFilmstripTileOwner(
  kind: "clip" | "span",
  id: string,
  index: number,
) {
  return `${kind}:${id}:tile:${index}`;
}

// The key of piece `index` of a layer clip's source track window (see
// source-track-content.ts) among the clip filmstrips and thumbnails. The
// first piece goes by the clip's own id.
export function getClipPieceKey(clipId: string, index: number) {
  return index ? `${clipId}#${index}` : clipId;
}
