import { basename } from "../../app/util.ts";
import type { MediaItem } from "../../media";
import {
  formatMediaAudio,
  formatMediaBitrate,
  formatMediaDetail,
  formatMediaDimensions,
  formatMediaFileSize,
  formatMediaFps,
  MISSING_DETAIL,
} from "../../media-details.ts";
import { describeMediaKind } from "./media-drawer-model.ts";

export type MediaDetailRow = { label: string; value: string };

// Joins the known parts of a detail with " · ", or "—" when none are.
function joinDetailParts(parts: (string | undefined)[]) {
  const known = parts.filter(
    (part): part is string => !!part && part !== MISSING_DETAIL,
  );
  return known.length ? known.join(" · ") : MISSING_DETAIL;
}

/** Epoch milliseconds → "Oct 1, 2026, 9:41 AM" in the viewer's locale. */
export function formatMediaModified(
  lastModified: number | undefined,
  locale?: string,
) {
  if (lastModified === undefined || !Number.isFinite(lastModified)) {
    return MISSING_DETAIL;
  }
  return new Date(lastModified).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The details pane's rows for `media`, its duration already formatted. The
 * Video row is left out of audio-only media and the Audio row out of
 * video-only media. Offline media adds its state and the last known file
 * name, never the full path.
 */
export function getMediaDetailRows(
  media: MediaItem,
  durationText: string,
  locale?: string,
): MediaDetailRow[] {
  const hasVideo = media.hasVideo || media.kind === "video";
  const rows: MediaDetailRow[] = [
    { label: "Name", value: media.name || MISSING_DETAIL },
    { label: "Kind", value: describeMediaKind(media) },
    { label: "Size", value: formatMediaFileSize(media.fileSizeBytes) },
    { label: "Container", value: formatMediaDetail(media.container) },
  ];
  if (hasVideo) {
    rows.push({
      label: "Video",
      value: joinDetailParts([
        media.videoCodec,
        formatMediaDimensions(media.width, media.height),
        formatMediaFps(media.fps),
      ]),
    });
  }
  if (media.hasAudio) {
    rows.push({
      label: "Audio",
      value: joinDetailParts([
        media.audioCodec,
        formatMediaAudio(media.sampleRate, media.channels),
      ]),
    });
  }
  rows.push(
    { label: "Duration", value: durationText || MISSING_DETAIL },
    { label: "Bitrate", value: formatMediaBitrate(media.bitrate) },
    {
      label: "Modified",
      value: formatMediaModified(media.lastModified, locale),
    },
  );
  if (media.availability === "offline") {
    rows.push({ label: "Status", value: "Offline" });
    const lastKnownName = basename(media.sourcePath);
    if (lastKnownName) {
      rows.push({ label: "Last known file", value: lastKnownName });
    }
  }
  return rows;
}
