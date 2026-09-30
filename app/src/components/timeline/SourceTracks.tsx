import { ChevronDownIcon } from "@heroicons/react/24/solid";
import type { Dispatch, SetStateAction } from "react";
import type {
  ArrangementClip,
  SourceSpan as SourceSpanClip,
  SourceTrack,
  SourceTrackDropTarget,
} from "../../app/types.ts";
import { getDraggedMediaFiles, pluralize } from "../../app/util.ts";
import type { useSourceTrackDrop } from "../../hooks/useSourceTrackDrop.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { formatSourceTracksSummary } from "../../source-tracks-section.ts";
import { SourceEmptyState } from "../SourceEmptyState";
import type { SourceSpanContext } from "./SourceSpan";
import { SourceTrackRow } from "./SourceTrackRow";
import "./source-tracks.css";

type SourceTracksProps = {
  sourceTracks: SourceTrack[];
  sourceSpansByTrack: ReadonlyMap<string, SourceSpanClip[]>;
  isSourceTracksCollapsed: boolean;
  setSourceTracksCollapsed: (collapsed: boolean) => void;
  drop: ReturnType<typeof useSourceTrackDrop>;
  importMediaIntoSourceTrack: (
    files: File[],
    target: SourceTrackDropTarget,
  ) => Promise<void>;
  clips: ArrangementClip[];
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  onImport: () => void;
  onOpenSample: () => void;
  onOpenSession: () => void;
  gridStyle: ReturnType<typeof useTimelineViewport>["gridStyle"];
  span: SourceSpanContext;
};

// The Source Tracks section: its collapsible header, which takes dropped
// media while there are no tracks or they are hidden, the tracks, and a
// drop row for a new track while media is dragged over them.
export function SourceTracks({
  sourceTracks,
  sourceSpansByTrack,
  isSourceTracksCollapsed,
  setSourceTracksCollapsed,
  drop,
  importMediaIntoSourceTrack,
  clips,
  setSelectedClipId,
  onImport,
  onOpenSample,
  onOpenSession,
  gridStyle,
  span,
}: SourceTracksProps) {
  const {
    sourceTrackDragPreview,
    isSourceTrackFileDragActive,
    sourceTrackDragPreviewDetail,
    sourceTrackDragPreviewOverflow,
    isNewSourceTrackDropTarget,
    clearSourceTrackDragState,
    scheduleSourceTrackDragClear,
    handleSourceTrackDragEvent,
  } = drop;
  const isSourceHeaderDropTarget =
    !sourceTracks.length || isSourceTracksCollapsed;

  function selectSource(sourceTrackId: string) {
    const match = clips.find((clip) => clip.sourceTrackId === sourceTrackId);
    if (match) {
      // Selecting never moves the playhead.
      setSelectedClipId(match.id);
    }
  }

  return (
    <>
      <section
        aria-label="Source track drop area"
        className={`source-header ${sourceTracks.length ? "" : "source-header--empty"} ${isSourceTracksCollapsed ? "source-header--collapsed" : ""} ${isSourceTracksCollapsed && isNewSourceTrackDropTarget ? "is-drop-target" : ""}`}
        data-source-track-drop-target={
          isSourceHeaderDropTarget ? "new-track" : undefined
        }
        onDragEnter={(event) => {
          if (isSourceHeaderDropTarget) {
            handleSourceTrackDragEvent(event, {
              kind: "new-track",
            });
          }
        }}
        onDragLeave={() => {
          if (isSourceHeaderDropTarget) {
            scheduleSourceTrackDragClear();
          }
        }}
        onDragOver={(event) => {
          if (isSourceHeaderDropTarget) {
            handleSourceTrackDragEvent(event, {
              kind: "new-track",
            });
          }
        }}
        onDrop={(event) => {
          if (!isSourceHeaderDropTarget) {
            return;
          }

          const files = getDraggedMediaFiles(event.dataTransfer);
          if (!files.length) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          clearSourceTrackDragState();
          void importMediaIntoSourceTrack(files, {
            kind: "new-track",
          });
        }}
      >
        <div className="track-label track-label--header">
          {sourceTracks.length ? (
            <button
              aria-expanded={!isSourceTracksCollapsed}
              className="source-header__toggle"
              onClick={() => setSourceTracksCollapsed(!isSourceTracksCollapsed)}
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

      {isSourceTracksCollapsed
        ? null
        : sourceTracks.map((track, index) => (
            <SourceTrackRow
              key={track.id}
              track={track}
              index={index}
              spans={sourceSpansByTrack.get(track.id) ?? []}
              drop={drop}
              importMediaIntoSourceTrack={importMediaIntoSourceTrack}
              onSelect={selectSource}
              gridStyle={gridStyle}
              span={span}
            />
          ))}
      {isSourceTrackFileDragActive && !isSourceTracksCollapsed ? (
        <section className="track-row track-row--source track-row--source-drop">
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
            data-source-track-drop-target="new-track"
            onDragEnter={(event) =>
              handleSourceTrackDragEvent(event, {
                kind: "new-track",
              })
            }
            onDragLeave={() => {
              scheduleSourceTrackDragClear();
            }}
            onDragOver={(event) =>
              handleSourceTrackDragEvent(event, {
                kind: "new-track",
              })
            }
            onDrop={(event) => {
              const files = getDraggedMediaFiles(event.dataTransfer);
              if (!files.length) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              clearSourceTrackDragState();
              void importMediaIntoSourceTrack(files, {
                kind: "new-track",
              });
            }}
            style={gridStyle}
          >
            {sourceTrackDragPreview ? (
              <div className="source-drop-preview source-drop-preview--new-track">
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
      ) : null}
    </>
  );
}
