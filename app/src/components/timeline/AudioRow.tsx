import { ArrowPathIcon, ChevronDownIcon } from "@heroicons/react/24/solid";
import { useMemo } from "react";
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
  isCollapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

// The Audio row: a read-only waveform of the resolved audio mix, which only
// clips make, with a summary of where it comes from and a Refresh button.
// It takes no files; a drop over it falls through to the timeline.
// It is docked at the bottom of the timeline panel, under the rows (Timeline
// footer), so it draws its own playhead line. Collapsed, it is a 20px row
// (row-heights.ts) that still draws the waveform, scaled down. The toggle
// collapses and expands it, as does a double-click anywhere on its label but
// the Refresh button.
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
  isCollapsed,
  setCollapsed,
}: AudioRowProps) {
  const { summary, peaks, computing, durationSeconds, refresh } = mix;
  const skeletonStyle =
    durationSeconds > 0
      ? { left: 0, width: ((durationSeconds * bpm) / 60) * quarterPx }
      : { left: visibleTimelineStartPx, width: visibleTimelineWidthPx };
  // Scans every peak, so only once per mix rather than on each scroll.
  const peakLevel = useMemo(
    () => (peaks ? mixPeakLevel(peaks).toFixed(2) : undefined),
    [peaks],
  );

  return (
    <section
      aria-label="Audio"
      className={`track-row track-row--bus ${isCollapsed ? "track-row--bus-collapsed" : ""}`}
      data-audio-row=""
      onContextMenu={openAudioMenu}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-clicking the label is a pointer shortcut for the toggle */}
      <div
        className="track-label"
        onDoubleClick={(event) => {
          if (
            !(
              event.target instanceof Element &&
              event.target.closest(".audio-row__toggle, .track-label__audio")
            )
          ) {
            setCollapsed(!isCollapsed);
          }
        }}
      >
        <button
          aria-expanded={!isCollapsed}
          className="audio-row__toggle"
          onClick={(event) => {
            // A double-click on the toggle toggles once, like one on the
            // rest of the label.
            if (event.detail < 2) {
              setCollapsed(!isCollapsed);
            }
          }}
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
      <div
        className={`track-row__content track-row__content--waveform ${computing && !prefersReducedMotion ? "is-syncing is-syncing--animated" : ""}`}
        data-audio-mix={computing ? "computing" : peaks ? "ready" : "empty"}
        data-audio-mix-level={peakLevel}
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
        <PlayheadLine
          className="audio-row__playhead"
          signal={playheadSignal}
          quarterPx={quarterPx}
          offsetPx={0}
        />
      </div>
    </section>
  );
}
