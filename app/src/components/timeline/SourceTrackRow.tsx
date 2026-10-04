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
import { isLayerFxEnabled } from "../../fx-stack";
import type { useFxEditing } from "../../hooks/useFxEditing.ts";
import type { LiveTake } from "../../hooks/useRecording.ts";
import type { useSourceTrackActions } from "../../hooks/useSourceTrackActions.ts";
import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { SOURCE_TRACKS_LOCKED_TITLE } from "../../source-tracks-section.ts";
import { NameInput } from "../NameInput";
import { LiveRecordingClip } from "./LiveRecordingClip";
import { SourceDropPreview } from "./SourceDropPreview";
import { SourceSpan, type SourceSpanContext } from "./SourceSpan";
import { TrackFxButton } from "./TrackFxButton";
import { TrackRecordArmButton } from "./TrackRecordArmButton";

type SourceTrackActions = ReturnType<typeof useSourceTrackActions>;

// What every source track label shares: its grip, its menu, the name field
// Rename… opens, its FX switch, and whether the source tracks are locked,
// which disables the grip but not the FX switch.
export type SourceTrackLabelContext = {
  reorder: SourceTrackActions["sourceTrackReorder"];
  openMenu: (event: ReactMouseEvent<HTMLElement>, trackId: string) => void;
  locked: boolean;
  renamingId: string | undefined;
  startRename: (trackId: string) => void;
  // A read-only tab ignores a double-click on the name instead of renaming.
  readOnly: boolean;
  commitRename: SourceTrackActions["commitSourceTrackRename"];
  cancelRename: SourceTrackActions["cancelSourceTrackRename"];
  setFxEnabled: ReturnType<typeof useFxEditing>["setSourceTrackFxEnabled"];
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
  armed: boolean;
  // The clip this track is recording into.
  liveTake: LiveTake | undefined;
} & SourceTrackLabelContext;

// A source track: its label with the reorder grip, its spans, and the
// preview of media dragged over it to import into it. Media dropped anywhere
// on the row, label and spans included, goes to this track, starting at the
// timeline position under the pointer. Clicking the
// label or empty space in the row selects the track; clicking a span selects
// the span. Double-clicking the track name renames it, like Rename… in its
// menu.
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
  armed,
  liveTake,
  reorder,
  openMenu,
  locked,
  renamingId,
  startRename,
  readOnly,
  commitRename,
  cancelRename,
  setFxEnabled,
}: SourceTrackRowProps) {
  const { sourceTrackDragTarget } = drop;
  const swatch = getSwatch(track.colorIndex);
  const isDropTarget =
    sourceTrackDragTarget?.kind === "track" &&
    sourceTrackDragTarget.trackId === track.id;
  const selected = isSourceTrackSelected(sourceSelection, track.id);

  return (
    <section
      className={`track-row track-row--source ${selected ? "track-row--selected" : ""} ${isLifted ? "track-row--lifted" : ""} ${armed ? "track-row--armed" : ""} ${liveTake ? "track-row--recording" : ""}`}
      data-source-track-drop-target="track"
      data-source-track-id={track.id}
      data-source-track-drop-at-pointer
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking anywhere on the label is a mouse shortcut; the track name button is the keyboard equivalent */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the track name button handles the keyboard */}
      <div
        className="track-label track-label--source"
        onContextMenu={(event) => openMenu(event, track.id)}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              ".track-label__grip, .track-label__fx, .track-label__arm, .track-label__rename",
            )
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
          disabled={locked}
          title={
            locked
              ? SOURCE_TRACKS_LOCKED_TITLE
              : "Drag to reorder, or press Enter to pick up"
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
            aria-current={selected ? "true" : undefined}
            className="track-label__select"
            data-source-track-label-id={track.id}
            onDoubleClick={() => {
              if (!readOnly) {
                startRename(track.id);
              }
            }}
            type="button"
          >
            <span>{track.name}</span>
            <small>
              {track.recordingPaths.length
                ? `${pluralize(track.recordingPaths.length, "file")} / key ${index + 1}`
                : `Imported media / key ${index + 1}`}
              {isLayerFxEnabled(track) ? "" : " · FX off"}
            </small>
          </button>
        )}
        <TrackFxButton
          track={track}
          setFxEnabled={(enabled) => setFxEnabled(track.id, enabled)}
        />
        <TrackRecordArmButton track={track} />
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
        {liveTake ? (
          <LiveRecordingClip
            bpm={span.bpm}
            quarterPx={span.quarterPx}
            take={liveTake}
          />
        ) : null}
        {isDropTarget ? (
          <SourceDropPreview drop={drop} span={span} swatch={swatch} />
        ) : null}
      </section>
    </section>
  );
}
