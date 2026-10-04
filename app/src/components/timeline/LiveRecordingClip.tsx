import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatDuration } from "../../app/format.ts";
import { secondsToQuarters } from "../../app/timeline-math.ts";
import type { LiveTake } from "../../hooks/useRecording.ts";
import { LIVE_PEAK_INTERVAL_SECONDS } from "../../recording/live-take-monitor.ts";
import { getVisibleClipSlice } from "../../waveform-range.ts";
import { LiveClipPainter } from "./live-recording-clip-draw.ts";
import "./live-recording-clip.css";

type LiveRecordingClipProps = {
  take: LiveTake;
  bpm: number;
  quarterPx: number;
  // What of the timeline is visible, in pixels, so only that part of a
  // long take is drawn.
  visibleStartPx: number;
  visibleWidthPx: number;
};

// Tiles are as tall as a source clip; the waveform is as tall as its CSS.
const TILE_HEIGHT_PX = 56;
const WAVEFORM_HEIGHT_PX = 32;

// The clip a track is recording into, from where recording started to now:
// the camera's frames along it and the microphone's waveform under them,
// growing until recording ends, with a red REC badge. Only this clip
// follows the take's length as it grows.
export function LiveRecordingClip({
  take,
  bpm,
  quarterPx,
  visibleStartPx,
  visibleWidthPx,
}: LiveRecordingClipProps) {
  const { monitor, store } = take;
  const durationSeconds = useSyncExternalStore(store.subscribe, () =>
    store.durationSeconds(take.trackId),
  );
  const leftPx = take.startQ * quarterPx;
  const pxPerSecond = secondsToQuarters(1, bpm) * quarterPx;
  const widthPx = Math.max(2, durationSeconds * pxPerSecond);
  // The canvases cover the visible part of the clip as it will be once it
  // fills the screen, so they keep their size, and their drawing, as the
  // clip grows across it.
  const slice = getVisibleClipSlice(
    leftPx,
    Math.max(widthPx, visibleStartPx + visibleWidthPx - leftPx),
    visibleStartPx,
    visibleWidthPx,
  );
  const sliceStartPx = Math.round(slice?.startPx ?? 0);
  const sliceWidthPx = Math.ceil(slice?.widthPx ?? 0);
  const tileWidthPx = TILE_HEIGHT_PX * monitor.aspect;
  const waveformRef = useRef<HTMLCanvasElement | null>(null);
  const filmstripRef = useRef<HTMLCanvasElement | null>(null);
  const [painter] = useState(() => new LiveClipPainter());

  // Draws what changed as the clip grows, scrolls or zooms.
  useLayoutEffect(() => {
    const view = {
      startPx: sliceStartPx,
      widthPx: sliceWidthPx,
      clipWidthPx: widthPx,
      pxPerSecond,
    };
    const filmstrip = filmstripRef.current;
    const filmstripContext = filmstrip?.getContext("2d");
    if (filmstrip && filmstripContext) {
      if (filmstrip.width !== sliceWidthPx) filmstrip.width = sliceWidthPx;
      if (filmstrip.height !== TILE_HEIGHT_PX) filmstrip.height = TILE_HEIGHT_PX;
      painter.paintFilmstrip(filmstripContext, view, {
        frames: monitor.frames,
        tileWidthPx,
        heightPx: TILE_HEIGHT_PX,
      });
    }
    const waveform = waveformRef.current;
    const waveformContext = waveform?.getContext("2d");
    if (waveform && waveformContext) {
      if (waveform.width !== sliceWidthPx) waveform.width = sliceWidthPx;
      if (waveform.height !== WAVEFORM_HEIGHT_PX) {
        waveform.height = WAVEFORM_HEIGHT_PX;
      }
      painter.paintWaveform(waveformContext, view, {
        peaks: monitor.peaks,
        peakIntervalSeconds: LIVE_PEAK_INTERVAL_SECONDS,
        heightPx: WAVEFORM_HEIGHT_PX,
      });
    }
  }, [
    monitor,
    painter,
    pxPerSecond,
    sliceStartPx,
    sliceWidthPx,
    tileWidthPx,
    widthPx,
  ]);

  const canvasStyle = { left: sliceStartPx, width: sliceWidthPx };
  return (
    <div
      aria-label={`Recording, ${formatDuration(durationSeconds)}`}
      className={`live-recording-clip ${take.ended ? "live-recording-clip--ended" : ""}`}
      data-live-recording-track-id={take.trackId}
      role="img"
      style={{ left: leftPx, width: widthPx }}
    >
      {take.hasVideo && sliceWidthPx ? (
        <canvas
          aria-hidden="true"
          className="live-recording-clip__filmstrip"
          ref={filmstripRef}
          style={canvasStyle}
        />
      ) : null}
      {take.hasAudio && sliceWidthPx ? (
        <canvas
          aria-hidden="true"
          className="live-recording-clip__waveform"
          ref={waveformRef}
          style={canvasStyle}
        />
      ) : null}
      <div className="live-recording-clip__body">
        <span className="live-recording-clip__badge">REC</span>
        <small>{formatDuration(durationSeconds)}</small>
      </div>
    </div>
  );
}
