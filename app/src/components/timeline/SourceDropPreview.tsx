import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";

type SourceDropPreviewProps = {
  drop: ReturnType<typeof useSourceTrackDrop>;
  quarterPx: number;
  newTrack?: boolean;
};

// The card of the media dragged over a source track row and an insertion
// line, both where the media will start: the snapped timeline position
// under the pointer.
export function SourceDropPreview({
  drop,
  quarterPx,
  newTrack = false,
}: SourceDropPreviewProps) {
  const {
    sourceTrackDragTarget,
    sourceTrackDragPreview,
    sourceTrackDragPreviewDetail,
    sourceTrackDragPreviewOverflow,
  } = drop;
  if (!sourceTrackDragPreview) {
    return null;
  }

  const left = (sourceTrackDragTarget?.startQ ?? 0) * quarterPx;

  return (
    <>
      <div
        aria-hidden="true"
        className="source-drop-indicator"
        style={{ left }}
      />
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
