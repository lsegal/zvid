import type {
  SourceSpan as SourceSpanClip,
  SourceTrack,
} from "../../app/types.ts";
import { getSwatch, pluralize } from "../../app/util.ts";
import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { SourceSpan, type SourceSpanContext } from "./SourceSpan";

type SourceTrackRowProps = {
  track: SourceTrack;
  index: number;
  spans: SourceSpanClip[];
  drop: ReturnType<typeof useSourceTrackDrop>;
  onSelect: (sourceTrackId: string) => void;
  gridStyle: ReturnType<typeof useTimelineViewport>["gridStyle"];
  span: SourceSpanContext;
};

// A source track: its label, its spans, and the preview of media dragged
// over it to import into it. Media dropped anywhere on the row, label and
// spans included, goes to this track.
export function SourceTrackRow({
  track,
  index,
  spans,
  drop,
  onSelect,
  gridStyle,
  span,
}: SourceTrackRowProps) {
  const {
    sourceTrackDragTarget,
    sourceTrackDragPreview,
    sourceTrackDragPreviewDetail,
    sourceTrackDragPreviewOverflow,
  } = drop;
  const swatch = getSwatch(track.colorIndex);
  const isDropTarget =
    sourceTrackDragTarget?.kind === "track" &&
    sourceTrackDragTarget.trackId === track.id;

  return (
    <section
      className="track-row track-row--source"
      data-source-track-drop-target="track"
      data-source-track-id={track.id}
    >
      <button
        className="track-label track-label--source"
        onClick={() => onSelect(track.id)}
        type="button"
      >
        <span
          className="track-label__stripe"
          style={{ backgroundColor: swatch.accent }}
        />
        <div>
          <span>{track.name}</span>
          <small>
            {track.recordingPaths.length
              ? `${pluralize(track.recordingPaths.length, "file")} / key ${index + 1}`
              : `Imported media / key ${index + 1}`}
          </small>
        </div>
      </button>
      <section
        aria-label={`Drop media into ${track.name}`}
        className={`track-row__content track-row__content--source ${isDropTarget ? "is-drop-target" : ""}`}
        style={gridStyle}
      >
        {spans.map((clip) => (
          <SourceSpan key={clip.id} clip={clip} {...span} />
        ))}
        {isDropTarget && sourceTrackDragPreview ? (
          <div className="source-drop-preview">
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
        ) : null}
      </section>
    </section>
  );
}
