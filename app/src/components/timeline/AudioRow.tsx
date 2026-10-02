import { ArrowPathIcon } from "@heroicons/react/24/solid";
import type { useAudioMix } from "../../hooks/useAudioMix.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { MainWaveform } from "../../MainWaveform";
import type { useMenus } from "../../menus/useMenus.ts";
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
};

// The Audio row: a read-only waveform of the resolved audio mix, which only
// clips make, with a summary of where it comes from and a Refresh button.
// It takes no files; a drop over it falls through to the timeline.
export function AudioRow({
  mix,
  openAudioMenu,
  prefersReducedMotion,
  bpm,
  quarterPx,
  visibleTimelineStartPx,
  visibleTimelineWidthPx,
  gridStyle,
}: AudioRowProps) {
  const { summary, peaks, computing, durationSeconds, refresh } = mix;
  const skeletonStyle =
    durationSeconds > 0
      ? { left: 0, width: ((durationSeconds * bpm) / 60) * quarterPx }
      : { left: visibleTimelineStartPx, width: visibleTimelineWidthPx };

  return (
    <section
      aria-label="Audio"
      className="track-row track-row--bus"
      data-audio-row=""
      onContextMenu={openAudioMenu}
    >
      <div className="track-label">
        <div className="track-label__index">A</div>
        <div>
          <span>Audio</span>
          <small>{summary}</small>
        </div>
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
      </div>
    </section>
  );
}
