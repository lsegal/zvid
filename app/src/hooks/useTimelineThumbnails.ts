import { useMemo } from "react";
import {
  CLIP_FILMSTRIP_HEIGHT_PX,
  type Filmstrip,
  getFilmstripTileOwner,
  SOURCE_SPAN_FILMSTRIP_HEIGHT_PX,
} from "../app/filmstrip.ts";
import { getClipDurationQ, quartersToSeconds } from "../app/timeline-math.ts";
import type { ArrangementClip, SourceSpan } from "../app/types.ts";
import { logClient } from "../app/util.ts";
import {
  getClipFilmstripTiles,
  getFilmstripDecodeSize,
  getFilmstripTileWidthPx,
  getSourceSpanFilmstripClip,
} from "../clip-filmstrip.ts";
import { isPlaceholderClip } from "../clip-media-state";
import type { MediaItem } from "../media";
import {
  getClipThumbnailTimeSeconds,
  getThumbnailCacheKey,
  type ThumbnailRequest,
  type ThumbnailSize,
} from "../thumbnail-cache.ts";
import { useThumbnailCache } from "../use-thumbnail-cache";

export type TimelineThumbnailsInputs = {
  bpm: number;
  quarterPx: number;
  timelineClips: ArrangementClip[];
  sourceSpans: SourceSpan[];
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  filmstripRangeStartPx: number;
  filmstripRangeEndPx: number;
};

// The filmstrips and thumbnails the timeline's clips and source spans show.
export function useTimelineThumbnails({
  bpm,
  quarterPx,
  timelineClips,
  sourceSpans,
  mediaItemsById,
  filmstripRangeStartPx,
  filmstripRangeEndPx,
}: TimelineThumbnailsInputs) {
  const pixelRatio = window.devicePixelRatio || 1;
  // The filmstrip tiles of each online video clip near the visible range.
  const clipFilmstrips = useMemo(() => {
    const filmstrips = new Map<string, Filmstrip>();
    const secondsPerPx = quartersToSeconds(1, bpm) / quarterPx;
    for (const clip of timelineClips) {
      const media = clip.mediaId ? mediaItemsById.get(clip.mediaId) : undefined;
      if (
        isPlaceholderClip(clip) ||
        !media?.hasVideo ||
        !media.previewUrl ||
        media.availability !== "ready"
      ) {
        continue;
      }

      const tileWidthPx = getFilmstripTileWidthPx(
        CLIP_FILMSTRIP_HEIGHT_PX,
        media.width,
        media.height,
      );
      filmstrips.set(clip.id, {
        media,
        size: getFilmstripDecodeSize(
          tileWidthPx,
          CLIP_FILMSTRIP_HEIGHT_PX,
          pixelRatio,
        ),
        tiles: getClipFilmstripTiles({
          clip,
          mediaDurationSeconds: media.durationSeconds,
          clipLeftPx: clip.startQ * quarterPx,
          clipWidthPx: getClipDurationQ(clip, bpm) * quarterPx,
          tileWidthPx,
          secondsPerPx,
          range: { startPx: filmstripRangeStartPx, endPx: filmstripRangeEndPx },
          bpm,
        }),
      });
    }
    return filmstrips;
  }, [
    bpm,
    filmstripRangeEndPx,
    filmstripRangeStartPx,
    mediaItemsById,
    pixelRatio,
    quarterPx,
    timelineClips,
  ]);
  // The filmstrip tiles of each online video source span near the visible
  // range.
  const spanFilmstrips = useMemo(() => {
    const filmstrips = new Map<string, Filmstrip>();
    const secondsPerPx = quartersToSeconds(1, bpm) / quarterPx;
    for (const span of sourceSpans) {
      const media = span.mediaId ? mediaItemsById.get(span.mediaId) : undefined;
      if (
        !media?.hasVideo ||
        !media.previewUrl ||
        media.availability !== "ready"
      ) {
        continue;
      }

      const tileWidthPx = getFilmstripTileWidthPx(
        SOURCE_SPAN_FILMSTRIP_HEIGHT_PX,
        media.width,
        media.height,
      );
      filmstrips.set(span.id, {
        media,
        size: getFilmstripDecodeSize(
          tileWidthPx,
          SOURCE_SPAN_FILMSTRIP_HEIGHT_PX,
          pixelRatio,
        ),
        tiles: getClipFilmstripTiles({
          clip: getSourceSpanFilmstripClip(span),
          mediaDurationSeconds: media.durationSeconds,
          clipLeftPx: span.startQ * quarterPx,
          clipWidthPx: getClipDurationQ(span, bpm) * quarterPx,
          tileWidthPx,
          secondsPerPx,
          range: { startPx: filmstripRangeStartPx, endPx: filmstripRangeEndPx },
          bpm,
        }),
      });
    }
    return filmstrips;
  }, [
    bpm,
    filmstripRangeEndPx,
    filmstripRangeStartPx,
    mediaItemsById,
    pixelRatio,
    quarterPx,
    sourceSpans,
  ]);
  // Source spans and layer clips share one thumbnail cache, so a frame both
  // show is decoded once. Spans show the frame at their start and clips the
  // first frame the compositor shows for them, until their own filmstrip
  // tiles are ready. That frame is decoded at the filmstrip's tile size, so it
  // is the same cache entry as the first tile.
  const thumbnailRequests = useMemo(() => {
    const requests: ThumbnailRequest<MediaItem>[] = [];
    const addRequest = (
      owner: string,
      media: MediaItem | undefined,
      size: ThumbnailSize | undefined,
      timeSeconds: (media: MediaItem) => number,
    ) => {
      if (
        !media?.hasVideo ||
        !media.previewUrl ||
        media.availability !== "ready"
      ) {
        return;
      }

      const time = timeSeconds(media);
      requests.push({
        key: getThumbnailCacheKey(media.id, time, size),
        owner,
        media,
        sourceUrl: media.previewUrl,
        timeSeconds: time,
        size,
      });
    };

    for (const span of sourceSpans) {
      addRequest(
        `span:${span.id}`,
        span.mediaId ? mediaItemsById.get(span.mediaId) : undefined,
        spanFilmstrips.get(span.id)?.size,
        () => span.trimStartSeconds,
      );
    }
    for (const clip of timelineClips) {
      if (isPlaceholderClip(clip)) {
        continue;
      }

      addRequest(
        `clip:${clip.id}`,
        clip.mediaId ? mediaItemsById.get(clip.mediaId) : undefined,
        clipFilmstrips.get(clip.id)?.size,
        (media) =>
          getClipThumbnailTimeSeconds(clip, media.durationSeconds, bpm),
      );
    }
    for (const [kind, filmstrips] of [
      ["clip", clipFilmstrips],
      ["span", spanFilmstrips],
    ] as const) {
      for (const [id, { media, size, tiles }] of filmstrips) {
        for (const tile of tiles) {
          addRequest(
            getFilmstripTileOwner(kind, id, tile.index),
            media,
            size,
            () => tile.timeSeconds,
          );
        }
      }
    }
    return requests;
  }, [
    bpm,
    clipFilmstrips,
    mediaItemsById,
    sourceSpans,
    spanFilmstrips,
    timelineClips,
  ]);
  const thumbnails = useThumbnailCache(thumbnailRequests, (request, error) => {
    logClient("thumbnail:error", {
      owner: request.owner,
      mediaId: request.media.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return { clipFilmstrips, spanFilmstrips, thumbnails };
}
