import { Bars3Icon } from "@heroicons/react/24/solid";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  isSourceTrackSelected,
  type SourceSelection,
  selectSourceTrack,
} from "../../app/source-selection.ts";
import type {
  SourceSpan as SourceSpanClip,
  SourceTrack,
} from "../../app/types.ts";
import { getSwatch, pluralize } from "../../app/util.ts";
import type { useSourceTrackActions } from "../../hooks/useSourceTrackActions.ts";
import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { SourceSpan, type SourceSpanContext } from "./SourceSpan";

// What every source track label shares: its grip and its menu.
export type SourceTrackLabelContext = {
  reorder: ReturnType<typeof useSourceTrackActions>["sourceTrackReorder"];
  openMenu: (event: ReactMouseEvent<HTMLElement>, trackId: string) => void;
};

type SourceTrackRowProps = {
  track: SourceTrack;
  index: number;
  spans: SourceSpanClip[];
  drop: ReturnType<typeof useSourceTrackDrop>;
  sourceSelection: SourceSelection | undefined;
  selectSource: (selection: SourceSelection) => void;
  isLifted: boolean;
  gridStyle: ReturnType<typeof useTimelineViewport>["gridStyle"];
  span: SourceSpanContext;
} & SourceTrackLabelContext;

// A source track: its label with the reorder grip, its spans, and the
// preview of media dragged over it to import into it. Media dropped anywhere
// on the row, label and spans included, goes to this track. Clicking the
// label or empty space in the row selects the track; clicking a span selects
// the span.
export function SourceTrackRow({
  track,
  index,
  spans,
  drop,
  sourceSelection,
  selectSource,
  isLifted,
  gridStyle,
  span,
  reorder,
  openMenu,
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
  const selected = isSourceTrackSelected(sourceSelection, track.id);

  return (
    <section
      className={`track-row track-row--source ${selected ? "track-row--selected" : ""} ${isLifted ? "track-row--lifted" : ""}`}
      data-source-track-drop-target="track"
      data-source-track-id={track.id}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere on the label is a mouse shortcut; the track name button is the keyboard equivalent */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the track name button handles the keyboard */}
      <div
        className="track-label track-label--source"
        onContextMenu={(event) => openMenu(event, track.id)}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(".track-label__grip")
          ) {
            return;
          }
          selectSource(selectSourceTrack(track.id));
        }}
      >
        <button
          {...reorder.gripProps(track, index)}
          aria-label={`Reorder ${track.name}`}
          className="track-label__grip"
          title="Drag to reorder, or press Space to pick up"
          type="button"
        >
          <Bars3Icon aria-hidden="true" />
        </button>
        <span
          className="track-label__stripe"
          style={{ backgroundColor: swatch.accent }}
        />
        <button
          aria-current={selected ? "true" : undefined}
          className="track-label__select"
          data-source-track-label-id={track.id}
          type="button"
        >
          <span>{track.name}</span>
          <small>
            {track.recordingPaths.length
              ? `${pluralize(track.recordingPaths.length, "file")} / key ${index + 1}`
              : `Imported media / key ${index + 1}`}
          </small>
        </button>
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: clearing the source clip selection is a mouse shortcut; the track name button selects the track from the keyboard */}
      <section
        aria-label={`Drop media into ${track.name}`}
        className={`track-row__content track-row__content--source ${isDropTarget ? "is-drop-target" : ""}`}
        onClick={(event) => {
          // Empty space clears the source clip selection, keeping its track
          // selected.
          if (event.target === event.currentTarget) {
            selectSource(selectSourceTrack(track.id));
          }
        }}
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
