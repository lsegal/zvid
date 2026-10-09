import {
  FilmIcon,
  PhotoIcon,
  SpeakerWaveIcon,
  SwatchIcon,
} from "@heroicons/react/24/solid";
import { isImageMedia, isLutMedia, type MediaItem } from "../../media";
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

// A media item's picture: a video frame or the image itself, or a glyph for
// audio-only media, LUTs and pictures not loaded yet, with the media sync skeleton while it hydrates.
export function MediaThumbnail({
  media,
  thumbnailUrl,
  mediaSync,
  prefersReducedMotion,
  badge,
}: MediaThumbnailProps) {
  const image = isImageMedia(media);
  const lut = isLutMedia(media);
  const Glyph = image
    ? PhotoIcon
    : lut
      ? SwatchIcon
      : media.hasVideo
        ? FilmIcon
        : SpeakerWaveIcon;
  return (
    <span
      className={[
        "media-thumb",
        image
          ? "media-thumb--image"
          : lut
            ? "media-thumb--lut"
            : media.hasVideo
              ? "media-thumb--video"
              : "media-thumb--audio",
        mediaSync ? getMediaSyncClassName(mediaSync, prefersReducedMotion) : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ["--clip-color" as string]: media.color,
        ["--clip-accent" as string]: media.accent,
      }}
    >
      {thumbnailUrl && (media.hasVideo || image) ? (
        // The item drags the media, not the frame's image file.
        <img
          alt=""
          className="media-thumb__image"
          draggable={false}
          src={thumbnailUrl}
        />
      ) : (
        <Glyph aria-hidden="true" className="media-thumb__glyph" />
      )}
      {mediaSync ? <MediaSyncSkeleton view={mediaSync} variant="clip" /> : null}
      {badge ? <span className="media-thumb__badge">{badge}</span> : null}
    </span>
  );
}
