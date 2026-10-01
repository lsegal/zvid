import { FilmIcon, SpeakerWaveIcon } from "@heroicons/react/24/solid";
import type { MediaItem } from "../../media";
import {
  getMediaSyncClassName,
  type MediaSyncView,
} from "../../remote-media-sync";
import { MediaSyncSkeleton } from "../MediaSyncSkeleton";

type MediaThumbnailProps = {
  media: MediaItem;
  thumbnailUrl: string | undefined;
  mediaSync: MediaSyncView | null;
  prefersReducedMotion: boolean;
  // Overlaid on the icon view's larger thumbnails; the list has a column.
  badge?: string;
};

// A media item's picture: a video frame, or a glyph for audio-only media and
// frames not decoded yet, with the media sync skeleton while it hydrates.
export function MediaThumbnail({
  media,
  thumbnailUrl,
  mediaSync,
  prefersReducedMotion,
  badge,
}: MediaThumbnailProps) {
  const Glyph = media.hasVideo ? FilmIcon : SpeakerWaveIcon;
  return (
    <span
      className={[
        "media-thumb",
        media.hasVideo ? "media-thumb--video" : "media-thumb--audio",
        mediaSync ? getMediaSyncClassName(mediaSync, prefersReducedMotion) : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ["--clip-color" as string]: media.color,
        ["--clip-accent" as string]: media.accent,
      }}
    >
      {thumbnailUrl && media.hasVideo ? (
        <img alt="" className="media-thumb__image" src={thumbnailUrl} />
      ) : (
        <Glyph aria-hidden="true" className="media-thumb__glyph" />
      )}
      {mediaSync ? <MediaSyncSkeleton view={mediaSync} variant="clip" /> : null}
      {badge ? <span className="media-thumb__badge">{badge}</span> : null}
    </span>
  );
}
