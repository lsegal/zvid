import { ArrowPathIcon, ChevronDownIcon } from "@heroicons/react/24/solid";
import { mixPeakLevel } from "../../audio-mix-peaks.ts";
import { audioRowToggleLabel } from "../../audio-row-section.ts";
import type { useAudioMix } from "../../hooks/useAudioMix.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { MainWaveform } from "../../MainWaveform";
import type { useMenus } from "../../menus/useMenus.ts";
import type { PlayheadSignal } from "../../playhead-signal";
import { PlayheadLine } from "../LivePlayhead";
import { MediaSyncSkeleton } from "../MediaSyncSkeleton";
import "./audio-row.css";

type AudioRowProps = {
  mix: ReturnType<typeof useAudioMix>;
  openAudioMenu: ReturnType<typeof useMenus>["openAudioMenu"];
  prefersReducedMotion: boolean;
  bpm: number;
  quarterPx: number;
  visibleTimelineStartPx: number;
  visibleTimelineWidthPx: number;
  gridStyle: ReturnType<typeof useTimelineViewport>["gridStyle"];
  playheadSignal: PlayheadSignal;
  isPinned: boolean;
  isCollapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

// The Audio row: a read-only waveform of the resolved audio mix, which only
// clips make, with a summary of where it comes from and a Refresh button.
// It takes no files; a drop over it falls through to the timeline.
// When the panel has room, it is pinned to the bottom of the timeline, over
// the rows scrolling under it, so it draws its own playhead line. Collapsed,
// it hides the waveform and only its header stays.
export function AudioRow({
  mix,
  openAudioMenu,
  prefersReducedMotion,
  bpm,
  quarterPx,
  visibleTimelineStartPx,
  visibleTimelineWidthPx,
  gridStyle,
  playheadSignal,
  isPinned,
  isCollapsed,
  setCollapsed,
}: AudioRowProps) {
  const { summary, peaks, computing, durationSeconds, refresh } = mix;
  const playhead = (
    <PlayheadLine
      className="audio-row__playhead"
      signal={playheadSignal}
      quarterPx={quarterPx}
      offsetPx={0}
    />
  );
  const skeletonStyle =
    durationSeconds > 0
      ? { left: 0, width: ((durationSeconds * bpm) / 60) * quarterPx }
      : { left: visibleTimelineStartPx, width: visibleTimelineWidthPx };

  return (
    <section
      aria-label="Audio"
      className={`track-row track-row--bus ${isPinned ? "track-row--bus-pinned" : ""} ${isCollapsed ? "track-row--bus-collapsed" : ""}`}
      data-audio-row=""
      onContextMenu={openAudioMenu}
    >
      <div className="track-label">
        <button
          aria-expanded={!isCollapsed}
          className="audio-row__toggle"
          onClick={() => setCollapsed(!isCollapsed)}
          title={audioRowToggleLabel(isCollapsed)}
          type="button"
        >
          <ChevronDownIcon aria-hidden="true" />
          <span className="track-label__index">A</span>
          <span className="audio-row__title">
            <span>Audio</span>
            <small title={summary}>{summary}</small>
          </span>
        </button>
        <button
          aria-label="Recompute audio"
          className="track-label__fx track-label__audio"
          onClick={refresh}
          title="Recompute audio"
          type="button"
        >
          <ArrowPathIcon aria-hidden="true" />
        </button>
      </div>
      {isCollapsed ? (
        <div className="track-row__content">{playhead}</div>
      ) : (
        <div
          className={`track-row__content track-row__content--waveform ${computing && !prefersReducedMotion ? "is-syncing is-syncing--animated" : ""}`}
          data-audio-mix={computing ? "computing" : peaks ? "ready" : "empty"}
          data-audio-mix-level={
            peaks ? mixPeakLevel(peaks).toFixed(2) : undefined
          }
          style={gridStyle}
        >
          {computing ? (
            <MediaSyncSkeleton style={skeletonStyle} variant="waveform" />
          ) : null}
          {!computing && !peaks ? (
            <div
              className="waveform__empty"
              style={{ left: visibleTimelineStartPx + 16 }}
            >
              {summary}
            </div>
          ) : null}
          {peaks ? (
            <MainWaveform
              bpm={bpm}
              peaks={peaks}
              quarterPx={quarterPx}
              visibleStartPx={visibleTimelineStartPx}
              visibleWidthPx={visibleTimelineWidthPx}
            />
          ) : null}
          {playhead}
        </div>
      )}
    </section>
  );
}
