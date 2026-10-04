import type { Filmstrip } from "../../app/filmstrip.ts";
import { getFilmstripTileOwner } from "../../app/filmstrip.ts";
import { getClipDurationQ } from "../../app/timeline-math.ts";
import type { ArrangementClip } from "../../app/types.ts";
import { describeClipMediaState } from "../../clip-media-state";
import { getClipWaveformKind } from "../../clip-waveform.ts";
import { useAudioClipPeaks } from "../../hooks/useAudioClipPeaks.ts";
import type { MediaItem } from "../../media";
import {
  describeMediaSync,
  type RemoteMediaProgressMap,
} from "../../remote-media-sync.ts";
import {
  getClipThumbnailTimeSeconds,
  getThumbnailCacheKey,
  type ThumbnailSnapshot,
} from "../../thumbnail-cache.ts";
import {
  getClipWaveformRange,
  getVisibleClipSlice,
} from "../../waveform-range.ts";
import { ClipWaveform } from "./ClipWaveform";
import { MediaLoopMarkers } from "./MediaLoopMarkers";

type ClipPieceMediaProps = {
  // One piece of a layer clip's source track window, playing one source
  // clip (see source-track-content.ts), and its filmstrip and thumbnail key.
  piece: ArrangementClip;
  pieceKey: string;
  // Where the clip card starts, which the piece is placed inside.
  clipStartQ: number;
  bpm: number;
  quarterPx: number;
  visibleTimelineStartPx: number;
  visibleTimelineWidthPx: number;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  thumbnails: ThumbnailSnapshot;
  clipFilmstrips: ReadonlyMap<string, Filmstrip>;
  remoteMediaProgress: RemoteMediaProgressMap;
};

// The frames, waveform and media loop markers of one piece of a clip card,
// over the part of the card that piece covers. The parts of a clip whose
// window holds no source clip draw none.
export function ClipPieceMedia({
  piece,
  pieceKey,
  clipStartQ,
  bpm,
  quarterPx,
  visibleTimelineStartPx,
  visibleTimelineWidthPx,
  mediaItemsById,
  thumbnails,
  clipFilmstrips,
  remoteMediaProgress,
}: ClipPieceMediaProps) {
  const media = piece.mediaId ? mediaItemsById.get(piece.mediaId) : undefined;
  const mediaState = describeClipMediaState(piece, media?.availability);
  const mediaSync = media
    ? describeMediaSync(remoteMediaProgress.get(media.id), media.availability)
    : null;
  const leftPx = piece.startQ * quarterPx;
  const widthPx = getClipDurationQ(piece, bpm) * quarterPx;
  const filmstrip =
    media?.hasVideo && mediaState === "online"
      ? clipFilmstrips.get(pieceKey)
      : undefined;
  // A tile shows the piece's first frame until its own frame is decoded.
  const firstFrameUrl =
    media && filmstrip
      ? (thumbnails.get(
          getThumbnailCacheKey(
            media.id,
            getClipThumbnailTimeSeconds(piece, media.durationSeconds, bpm),
            filmstrip.size,
          ),
          `clip:${pieceKey}`,
        ) ?? media.thumbnailUrl)
      : undefined;
  const waveformKind = getClipWaveformKind(piece, media, mediaState);
  const waveformRange = getClipWaveformRange(
    piece,
    bpm,
    quarterPx,
    media?.durationSeconds ?? 0,
  );
  const inView = getVisibleClipSlice(
    leftPx,
    widthPx,
    visibleTimelineStartPx,
    visibleTimelineWidthPx,
  );
  const audioPeaks = useAudioClipPeaks(
    media,
    waveformKind === "overlay" && !inView ? "none" : waveformKind,
  );
  const audio =
    !mediaSync && waveformKind === "audio" && audioPeaks.status !== "none";
  const waveformOverlay =
    !mediaSync && waveformKind === "overlay" && audioPeaks.status === "ready";

  return (
    <span
      aria-hidden="true"
      className="clip-card__piece"
      data-piece-span-id={piece.sourceSpanId}
      style={{ left: (piece.startQ - clipStartQ) * quarterPx, width: widthPx }}
    >
      {audio ? (
        <ClipWaveform
          className="clip-card__waveform"
          clipLeftPx={leftPx}
          clipWidthPx={widthPx}
          peaks={audioPeaks}
          range={waveformRange}
          visibleStartPx={visibleTimelineStartPx}
          visibleWidthPx={visibleTimelineWidthPx}
        />
      ) : null}
      {filmstrip ? (
        <span className="clip-card__filmstrip">
          {filmstrip.tiles.map((tile) => {
            const tileUrl =
              thumbnails.get(
                getThumbnailCacheKey(
                  filmstrip.media.id,
                  tile.timeSeconds,
                  filmstrip.size,
                ),
                getFilmstripTileOwner("clip", pieceKey, tile.index),
              ) ?? firstFrameUrl;
            return (
              <span
                key={tile.index}
                className="clip-card__tile"
                style={{
                  left: tile.leftPx,
                  width: tile.widthPx,
                  backgroundImage: tileUrl ? `url(${tileUrl})` : undefined,
                }}
              />
            );
          })}
        </span>
      ) : null}
      {waveformOverlay ? (
        <ClipWaveform
          className="clip-card__waveform-overlay"
          clipLeftPx={leftPx}
          clipWidthPx={widthPx}
          peaks={audioPeaks}
          range={waveformRange}
          visibleStartPx={visibleTimelineStartPx}
          visibleWidthPx={visibleTimelineWidthPx}
        />
      ) : null}
      {media && !mediaSync && mediaState === "online" ? (
        <MediaLoopMarkers
          clipLeftPx={leftPx}
          clipWidthPx={widthPx}
          range={waveformRange}
          visibleStartPx={visibleTimelineStartPx}
          visibleWidthPx={visibleTimelineWidthPx}
        />
      ) : null}
    </span>
  );
}
