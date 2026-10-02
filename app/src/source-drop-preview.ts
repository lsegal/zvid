// The preview of media dragged from the Media drawer over a source track:
// the clips the drop will create, back to back from the drop position, each
// as long as its In/Out range and showing the frame at its In point.
import { secondsToQuarters } from "./app/timeline-math.ts";
import { stripFilenameExtension } from "./app/util.ts";
import type { MediaItem, MediaKind } from "./media.ts";
import { getMediaClipTrim } from "./source-track-media.ts";
import {
  getThumbnailCacheKey,
  type ThumbnailRequest,
} from "./thumbnail-cache.ts";

// A clip the drop will create, trimmed the way `addMediaToSourceTrack` trims
// it.
export type SourceDropPreviewItem = {
  mediaId: string;
  label: string;
  kind: MediaKind;
  inSeconds: number;
  durationSeconds: number;
};

export function getSourceDropPreviewItems(
  items: readonly MediaItem[],
): SourceDropPreviewItem[] {
  return items.map((item) => {
    const { trimStartSeconds, durationSeconds } = getMediaClipTrim(item);
    return {
      mediaId: item.id,
      label: stripFilenameExtension(item.name),
      kind: item.kind,
      inSeconds: trimStartSeconds,
      durationSeconds,
    };
  });
}

/**
 * Where the preview of `items` dropped at `startQ` sits, in pixels: its left
 * edge and total width on the timeline, and each item's offset and width
 * within it, the same as the clips the drop places.
 */
export function getSourceDropPreviewLayout(
  items: readonly Pick<SourceDropPreviewItem, "durationSeconds">[],
  startQ: number,
  bpm: number,
  quarterPx: number,
) {
  let offsetPx = 0;
  const segments = items.map(({ durationSeconds }) => {
    const widthPx = secondsToQuarters(durationSeconds, bpm) * quarterPx;
    const segment = { leftPx: offsetPx, widthPx };
    offsetPx += widthPx;
    return segment;
  });
  return { leftPx: startQ * quarterPx, widthPx: offsetPx, segments };
}

export function getSourceDropPreviewThumbnailOwner(index: number) {
  return `drop-preview:${index}`;
}

// The In frame of each previewed video item that can be decoded, at the
// harness's default size.
export function getSourceDropPreviewThumbnailRequests(
  items: readonly SourceDropPreviewItem[],
  mediaItemsById: ReadonlyMap<string, MediaItem>,
): ThumbnailRequest<MediaItem>[] {
  return items.flatMap((item, index) => {
    const media = mediaItemsById.get(item.mediaId);
    if (
      !media?.hasVideo ||
      !media.previewUrl ||
      media.availability !== "ready"
    ) {
      return [];
    }
    return [
      {
        key: getThumbnailCacheKey(media.id, item.inSeconds),
        owner: getSourceDropPreviewThumbnailOwner(index),
        media,
        sourceUrl: media.previewUrl,
        timeSeconds: item.inSeconds,
      },
    ];
  });
}
