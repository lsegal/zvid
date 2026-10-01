import {
  ChevronDownIcon,
  LockClosedIcon,
  LockOpenIcon,
} from "@heroicons/react/24/solid";
import type { RefObject } from "react";
import type { SourceSelection } from "../../app/source-selection.ts";
import type {
  SourceSpan as SourceSpanClip,
  SourceTrack,
} from "../../app/types.ts";
import { pluralize } from "../../app/util.ts";
import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import {
  formatSourceTracksSummary,
  sourceTracksLockLabel,
} from "../../source-tracks-section.ts";
import { SourceEmptyState } from "../SourceEmptyState";
import { SourceDropPreview } from "./SourceDropPreview";
import type { SourceSpanContext } from "./SourceSpan";
import { type SourceTrackLabelContext, SourceTrackRow } from "./SourceTrackRow";
import "./source-tracks.css";

type SourceTracksProps = {
  sourceTracks: SourceTrack[];
  sourceSpansByTrack: ReadonlyMap<string, SourceSpanClip[]>;
  isSourceTracksCollapsed: boolean;
  setSourceTracksCollapsed: (collapsed: boolean) => void;
  sourceTracksLocked: boolean;
  setSourceTracksLocked: (locked: boolean) => void;
  drop: ReturnType<typeof useSourceTrackDrop>;
  sourceSelection: SourceSelection | undefined;
  selectSource: (selection: SourceSelection) => void;
  onImport: () => void;
  onOpenSample: () => void;
  onOpenSession: () => void;
  gridStyle: ReturnType<typeof useTimelineViewport>["gridStyle"];
  span: SourceSpanContext;
  listRef: RefObject<HTMLDivElement | null>;
  label: SourceTrackLabelContext;
};

// The Source Tracks section: its collapsible header with the lock toggle,
// which takes dropped media while there are no tracks or they are hidden, the
// tracks with the drop indicator and announcements that reordering them uses,
// and a drop row for a new track while media is dragged over them. Locked
// tracks are 30% less saturated and their clips stay put.
export function SourceTracks({
  sourceTracks,
  sourceSpansByTrack,
  isSourceTracksCollapsed,
  setSourceTracksCollapsed,
  sourceTracksLocked,
  setSourceTracksLocked,
  drop,
  sourceSelection,
  selectSource,
  onImport,
  onOpenSample,
  onOpenSession,
  gridStyle,
  span,
  listRef,
  label,
}: SourceTracksProps) {
  const { reorder } = label;
  const { isSourceTrackFileDragActive, isNewSourceTrackDropTarget } = drop;
  const isSourceHeaderDropTarget =
    !sourceTracks.length || isSourceTracksCollapsed;

  return (
    <>
      <section
        aria-label="Source track drop area"
        className={`source-header ${sourceTracks.length ? "" : "source-header--empty"} ${isSourceTracksCollapsed ? "source-header--collapsed" : ""} ${isSourceTracksCollapsed && isNewSourceTrackDropTarget ? "is-drop-target" : ""}`}
        data-source-track-drop-target={
          isSourceHeaderDropTarget ? "new-track" : undefined
        }
      >
        <div className="track-label track-label--header">
          {sourceTracks.length ? (
            <>
              <button
                aria-expanded={!isSourceTracksCollapsed}
                className="source-header__toggle"
                onClick={() =>
                  setSourceTracksCollapsed(!isSourceTracksCollapsed)
                }
                title={
                  isSourceTracksCollapsed
                    ? "Show source tracks"
                    : "Hide source tracks"
                }
                type="button"
              >
                <ChevronDownIcon aria-hidden="true" />
                <span className="source-header__title">
                  <span>Source Tracks</span>
                  <small>
                    {pluralize(sourceTracks.length, "track")} in session
                  </small>
                </span>
              </button>
              <button
                aria-label={sourceTracksLockLabel(!sourceTracksLocked)}
                aria-pressed={sourceTracksLocked}
                className="source-header__lock"
                onClick={() => setSourceTracksLocked(!sourceTracksLocked)}
                title={sourceTracksLockLabel(!sourceTracksLocked)}
                type="button"
              >
                {sourceTracksLocked ? (
                  <LockClosedIcon aria-hidden="true" />
                ) : (
                  <LockOpenIcon aria-hidden="true" />
                )}
              </button>
            </>
          ) : (
            <div>
              <span>Source Tracks</span>
              <small>
                {pluralize(sourceTracks.length, "track")} in session
              </small>
            </div>
          )}
        </div>
        <div className="source-header__content">
          {isSourceTracksCollapsed ? (
            <span className="source-header__summary">
              {formatSourceTracksSummary(sourceTracks.length)} hidden
            </span>
          ) : null}
          {sourceTracks.length ? null : (
            <SourceEmptyState
              onImport={onImport}
              onOpenSample={onOpenSample}
              onOpenSession={onOpenSession}
            />
          )}
        </div>
      </section>

      {isSourceTracksCollapsed || !sourceTracks.length ? null : (
        <div
          ref={listRef}
          className={`source-track-list ${sourceTracksLocked ? "source-tracks--locked" : ""} ${reorder.listClassName}`}
        >
          <div
            aria-hidden="true"
            className="layer-drop-indicator"
            ref={reorder.indicatorRef}
          />
          <div
            aria-live="polite"
            className="layer-reorder-status"
            role="status"
          >
            {reorder.announcement}
          </div>
          {sourceTracks.map((track, index) => (
            <SourceTrackRow
              key={track.id}
              track={track}
              index={index}
              spans={sourceSpansByTrack.get(track.id) ?? []}
              drop={drop}
              sourceSelection={sourceSelection}
              selectSource={selectSource}
              isLifted={track.id === reorder.liftedLaneId}
              gridStyle={gridStyle}
              span={span}
              {...label}
            />
          ))}
        </div>
      )}
      {isSourceTrackFileDragActive && !isSourceTracksCollapsed ? (
        <section
          className="track-row track-row--source track-row--source-drop"
          data-source-track-drop-target="new-track"
          data-source-track-drop-at-pointer
        >
          <div className="track-label track-label--source track-label--source-drop">
            <span className="track-label__stripe" />
            <div>
              <span>New Source Track</span>
              <small>Drop here to create a new source track</small>
            </div>
          </div>
          <section
            aria-label="Drop media into a new source track"
            className={`track-row__content track-row__content--source track-row__content--source-drop ${isNewSourceTrackDropTarget ? "is-drop-target" : ""}`}
            style={gridStyle}
          >
            <SourceDropPreview
              drop={drop}
              quarterPx={span.quarterPx}
              newTrack
            />
          </section>
        </section>
      ) : null}
    </>
  );
}
