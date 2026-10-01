import { Bars3Icon } from "@heroicons/react/24/solid";
import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  SourceSpan as SourceSpanClip,
  SourceTrack,
} from "../../app/types.ts";
import { getSwatch, pluralize } from "../../app/util.ts";
import type { useSourceTrackActions } from "../../hooks/useSourceTrackActions.ts";
import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { SOURCE_TRACKS_LOCKED_TITLE } from "../../source-tracks-section.ts";
import { NameInput } from "../NameInput";
import { SourceSpan, type SourceSpanContext } from "./SourceSpan";

type SourceTrackActions = ReturnType<typeof useSourceTrackActions>;

// What every source track label shares: its grip, its menu, the name field
// Rename… opens, and whether the source tracks are locked, which disables
// the grip.
export type SourceTrackLabelContext = {
  reorder: SourceTrackActions["sourceTrackReorder"];
  openMenu: (event: ReactMouseEvent<HTMLElement>, trackId: string) => void;
  locked: boolean;
  renamingId: string | undefined;
  commitRename: SourceTrackActions["commitSourceTrackRename"];
  cancelRename: SourceTrackActions["cancelSourceTrackRename"];
};

type SourceTrackRowProps = {
  track: SourceTrack;
  index: number;
  spans: SourceSpanClip[];
  drop: ReturnType<typeof useSourceTrackDrop>;
  onSelect: (sourceTrackId: string) => void;
  isLifted: boolean;
  gridStyle: ReturnType<typeof useTimelineViewport>["gridStyle"];
  span: SourceSpanContext;
} & SourceTrackLabelContext;

// A source track: its label with the reorder grip, its spans, and the
// preview of media dragged over it to import into it. Media dropped anywhere
// on the row, label and spans included, goes to this track.
export function SourceTrackRow({
  track,
  index,
  spans,
  drop,
  onSelect,
  isLifted,
  gridStyle,
  span,
  reorder,
  openMenu,
  locked,
  renamingId,
  commitRename,
  cancelRename,
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
      className={`track-row track-row--source ${isLifted ? "track-row--lifted" : ""}`}
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
            event.target.closest(".track-label__grip, .track-label__rename")
          ) {
            return;
          }
          onSelect(track.id);
        }}
      >
        <button
          {...reorder.gripProps(track, index)}
          aria-label={`Reorder ${track.name}`}
          className="track-label__grip"
          disabled={locked}
          title={
            locked
              ? SOURCE_TRACKS_LOCKED_TITLE
              : "Drag to reorder, or press Space to pick up"
          }
          type="button"
        >
          <Bars3Icon aria-hidden="true" />
        </button>
        <span
          className="track-label__stripe"
          style={{ backgroundColor: swatch.accent }}
        />
        {renamingId === track.id ? (
          <NameInput
            initialName={track.name}
            label="Source track name"
            onCancel={() => cancelRename(track.id)}
            onSubmit={(name) => commitRename(track.id, name)}
          />
        ) : (
          <button
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
        )}
      </div>
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
