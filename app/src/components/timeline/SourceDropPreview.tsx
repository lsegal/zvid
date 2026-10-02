import { SpeakerWaveIcon } from "@heroicons/react/24/solid";
import { formatDuration } from "../../app/format.ts";
import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";
import { useAudioClipPeaks } from "../../hooks/useAudioClipPeaks.ts";
import type { MediaItem } from "../../media";
import {
  getSourceDropPreviewLayout,
  getSourceDropPreviewThumbnailOwner,
  type SourceDropPreviewItem,
} from "../../source-drop-preview.ts";
import {
  getThumbnailCacheKey,
  type ThumbnailSnapshot,
} from "../../thumbnail-cache.ts";
import { getSourceSpanWaveformRange } from "../../waveform-range.ts";
import { ClipWaveform } from "./ClipWaveform";
import type { SourceSpanContext } from "./SourceSpan";

type SourceDropPreviewProps = {
  drop: ReturnType<typeof useSourceTrackDrop>;
  span: SourceSpanContext;
  // The colors of the track the media will land in.
  swatch: { color: string; accent: string };
  newTrack?: boolean;
};

// An insertion line where the media dragged over a source track row will
// start, the snapped timeline position under the pointer, and a preview of
// it there. Media from the Media drawer previews as the clips the drop will
// create, as long as their In/Out ranges at the current zoom. Files from the
// OS have no known length until they are dropped, so they preview as a card.
export function SourceDropPreview({
  drop,
  span,
  swatch,
  newTrack = false,
}: SourceDropPreviewProps) {
  const {
    sourceTrackDragTarget,
    sourceTrackDragPreview,
    sourceTrackDragPreviewDetail,
    sourceTrackDragPreviewOverflow,
    sourceTrackDragThumbnails,
  } = drop;
  if (!sourceTrackDragPreview) {
    return null;
  }

  const { bpm, quarterPx } = span;
  const startQ = sourceTrackDragTarget?.startQ ?? 0;
  const left = startQ * quarterPx;
  const items = sourceTrackDragPreview.items;
  const indicator = (
    <div aria-hidden="true" className="source-drop-indicator" style={{ left }} />
  );

  if (items?.length) {
    const layout = getSourceDropPreviewLayout(items, startQ, bpm, quarterPx);
    return (
      <>
        {indicator}
        <div
          className={`source-drop-preview source-drop-preview--clips ${newTrack ? "source-drop-preview--new-track" : ""}`}
          style={{ left: layout.leftPx, width: layout.widthPx }}
        >
          {items.map((item, index) => {
            const segment = layout.segments[index];
            return segment ? (
              <SourceDropPreviewClip
                // biome-ignore lint/suspicious/noArrayIndexKey: the same media can be dragged twice, so its position is its identity
                key={index}
                item={item}
                index={index}
                media={span.mediaItemsById.get(item.mediaId)}
                clipLeftPx={layout.leftPx + segment.leftPx}
                leftPx={segment.leftPx}
                widthPx={segment.widthPx}
                thumbnails={sourceTrackDragThumbnails}
                swatch={swatch}
                span={span}
              />
            ) : null;
          })}
        </div>
      </>
    );
  }

  return (
    <>
      {indicator}
      <div
        className={`source-drop-preview ${newTrack ? "source-drop-preview--new-track" : ""}`}
        style={{ left }}
      >
        <div
          className={`source-drop-preview__thumb ${
            sourceTrackDragPreview.thumbnailUrl ? "has-image" : ""
          }`}
          style={
            sourceTrackDragPreview.thumbnailUrl
              ? {
                  backgroundImage: `url(${sourceTrackDragPreview.thumbnailUrl})`,
                }
              : undefined
          }
        />
        <div className="source-drop-preview__body">
          <strong>{sourceTrackDragPreview.label}</strong>
          <span>{sourceTrackDragPreviewDetail}</span>
        </div>
        {sourceTrackDragPreviewOverflow ? (
          <div className="source-drop-preview__count">
            {sourceTrackDragPreviewOverflow}
          </div>
        ) : null}
      </div>
    </>
  );
}

type SourceDropPreviewClipProps = {
  item: SourceDropPreviewItem;
  index: number;
  media: MediaItem | undefined;
  // Where the clip sits on the timeline, and within the preview.
  clipLeftPx: number;
  leftPx: number;
  widthPx: number;
  thumbnails: ThumbnailSnapshot;
  swatch: { color: string; accent: string };
  span: SourceSpanContext;
};

// One clip the drop will create, drawn like a source clip: the frame at its
// In point, or the poster until that is decoded, or for audio-only media the
// In…Out slice of its waveform, or a speaker glyph until its peaks are ready.
function SourceDropPreviewClip({
  item,
  index,
  media,
  clipLeftPx,
  leftPx,
  widthPx,
  thumbnails,
  swatch,
  span,
}: SourceDropPreviewClipProps) {
  const audioOnly = media ? !media.hasVideo : item.kind === "audio";
  const peaks = useAudioClipPeaks(media, audioOnly ? "audio" : "none");
  const thumbnailKey = media?.hasVideo
    ? getThumbnailCacheKey(media.id, item.inSeconds)
    : undefined;
  const thumbnailUrl = thumbnailKey
    ? (thumbnails.get(
        thumbnailKey,
        getSourceDropPreviewThumbnailOwner(index),
      ) ?? media?.thumbnailUrl)
    : undefined;

  return (
    <div
      className={`source-drop-clip ${audioOnly ? "source-drop-clip--audio" : ""}`}
      data-in-seconds={item.inSeconds}
      style={{
        left: leftPx,
        width: widthPx,
        backgroundColor: swatch.color,
        borderColor: swatch.accent,
      }}
    >
      {audioOnly ? (
        peaks.status === "ready" ? (
          <ClipWaveform
            className="source-drop-clip__waveform"
            clipLeftPx={clipLeftPx}
            clipWidthPx={widthPx}
            peaks={peaks}
            range={getSourceSpanWaveformRange(
              {
                trimStartSeconds: item.inSeconds,
                durationSeconds: item.durationSeconds,
              },
              span.bpm,
              span.quarterPx,
            )}
            visibleStartPx={span.visibleTimelineStartPx}
            visibleWidthPx={span.visibleTimelineWidthPx}
          />
        ) : (
          <SpeakerWaveIcon
            aria-hidden="true"
            className="source-drop-clip__glyph"
          />
        )
      ) : (
        <div
          className="source-drop-clip__thumb"
          data-thumbnail-key={thumbnailKey}
          style={
            thumbnailUrl
              ? { backgroundImage: `url(${thumbnailUrl})` }
              : undefined
          }
        />
      )}
      <div className="source-drop-clip__body">
        <span>{item.label}</span>
        <small>
          {`${item.kind === "audio" ? "Audio" : "Video"} · ${formatDuration(
            item.durationSeconds,
          )}`}
        </small>
      </div>
    </div>
  );
}
