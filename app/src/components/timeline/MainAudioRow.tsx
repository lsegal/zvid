import {
  ArrowPathRoundedSquareIcon,
  ArrowUpTrayIcon,
} from "@heroicons/react/24/solid";
import {
  getMainAudioSkeletonStyle,
  type useMainAudio,
  type useMainAudioDrop,
} from "../../hooks/useMainAudio.ts";
import type { useTimelineViewport } from "../../hooks/useTimelineViewport.ts";
import { MainWaveform } from "../../MainWaveform";
import type { useMenus } from "../../menus/useMenus.ts";
import { getMediaSyncClassName } from "../../remote-media-sync.ts";
import { MediaSyncSkeleton } from "../MediaSyncSkeleton";

type MainAudioRowProps = {
  audio: ReturnType<typeof useMainAudio>;
  drop: ReturnType<typeof useMainAudioDrop>;
  openMainAudioMenu: ReturnType<typeof useMenus>["openMainAudioMenu"];
  prefersReducedMotion: boolean;
  bpm: number;
  quarterPx: number;
  visibleTimelineStartPx: number;
  visibleTimelineWidthPx: number;
  gridStyle: ReturnType<typeof useTimelineViewport>["gridStyle"];
};

// The Audio row: the main audio's name and replace button, and its waveform
// or sync skeleton. Dropping an audio file on it replaces the main audio.
export function MainAudioRow({
  audio,
  drop,
  openMainAudioMenu,
  prefersReducedMotion,
  bpm,
  quarterPx,
  visibleTimelineStartPx,
  visibleTimelineWidthPx,
  gridStyle,
}: MainAudioRowProps) {
  const {
    mainAudio,
    currentMainWaveform,
    mainAudioSync,
    mainWaveformMessage,
    isMainAudioDropTarget,
    mainAudioInputRef,
    replaceMainAudioFromFile,
  } = audio;
  const {
    handleMainAudioDragEvent,
    handleMainAudioDragLeave,
    handleMainAudioDrop,
  } = drop;
  const mainAudioSkeletonStyle = getMainAudioSkeletonStyle({
    mainAudio,
    bpm,
    quarterPx,
    visibleTimelineStartPx,
    visibleTimelineWidthPx,
  });

  return (
    <section
      aria-label="Main audio drop area"
      className={`track-row track-row--bus ${isMainAudioDropTarget ? "is-drop-target" : ""}`}
      data-main-audio-drop-target=""
      onContextMenu={openMainAudioMenu}
      onDragEnter={handleMainAudioDragEvent}
      onDragLeave={handleMainAudioDragLeave}
      onDragOver={handleMainAudioDragEvent}
      onDrop={handleMainAudioDrop}
    >
      <div className="track-label">
        <div className="track-label__index">A</div>
        <div>
          <span>Audio</span>
          <small>{mainAudio ? mainAudio.name : "No main audio"}</small>
        </div>
        <button
          aria-label={mainAudio ? "Replace main audio" : "Add main audio"}
          className="track-label__fx track-label__audio"
          onClick={() => mainAudioInputRef.current?.click()}
          title={mainAudio ? "Replace main audio" : "Add main audio"}
          type="button"
        >
          {mainAudio ? (
            <ArrowPathRoundedSquareIcon aria-hidden="true" />
          ) : (
            <ArrowUpTrayIcon aria-hidden="true" />
          )}
        </button>
        <input
          accept="audio/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void replaceMainAudioFromFile(file);
            }
          }}
          ref={mainAudioInputRef}
          type="file"
        />
      </div>
      <div
        className={`track-row__content track-row__content--waveform ${mainAudioSync ? getMediaSyncClassName(mainAudioSync, prefersReducedMotion) : ""}`}
        style={gridStyle}
      >
        {mainAudioSync ? (
          <MediaSyncSkeleton
            style={mainAudioSkeletonStyle}
            variant="waveform"
            view={mainAudioSync}
          />
        ) : null}
        {mainWaveformMessage ? (
          <div
            className="waveform__empty"
            style={{ left: visibleTimelineStartPx + 16 }}
          >
            {mainWaveformMessage}
          </div>
        ) : null}
        {currentMainWaveform?.peaks ? (
          <MainWaveform
            bpm={bpm}
            peaks={currentMainWaveform.peaks}
            quarterPx={quarterPx}
            visibleStartPx={visibleTimelineStartPx}
            visibleWidthPx={visibleTimelineWidthPx}
          />
        ) : null}
      </div>
    </section>
  );
}
