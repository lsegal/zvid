import { useEffect, useRef } from "react";
import { formatDuration } from "../../app/format.ts";
import { secondsToQuarters } from "../../app/timeline-math.ts";
import type { LiveTake } from "../../hooks/useRecording.ts";
import {
  LIVE_PEAK_INTERVAL_SECONDS,
  liveFrameAt,
} from "../../recording/live-take-monitor.ts";
import "./live-recording-clip.css";

type LiveRecordingClipProps = {
  take: LiveTake;
  bpm: number;
  quarterPx: number;
};

// Tiles are as tall as a source clip.
const TILE_HEIGHT_PX = 56;

// The clip a track is recording into, from where recording started to now:
// the camera's frames along it and the microphone's waveform under them,
// growing until recording ends, with a red REC badge.
export function LiveRecordingClip({
  take,
  bpm,
  quarterPx,
}: LiveRecordingClipProps) {
  const { monitor, durationSeconds } = take;
  const leftPx = take.startQ * quarterPx;
  const widthPx = Math.max(
    2,
    secondsToQuarters(durationSeconds, bpm) * quarterPx,
  );
  const pxPerSecond = durationSeconds > 0 ? widthPx / durationSeconds : 0;
  const tileWidthPx = TILE_HEIGHT_PX * monitor.aspect;
  const tileCount =
    take.hasVideo && monitor.frames.length
      ? Math.ceil(widthPx / tileWidthPx)
      : 0;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Redraws as the clip grows; peaks spread over the clip's width.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !take.hasAudio) return;
    const width = Math.max(1, Math.round(widthPx));
    const height = canvas.clientHeight || 32;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(255, 214, 214, 0.85)";
    const peaks = monitor.peaks;
    const shownPeaks = Math.min(
      peaks.length,
      Math.ceil(durationSeconds / LIVE_PEAK_INTERVAL_SECONDS),
    );
    for (let x = 0; x < width; x += 1) {
      const from = Math.floor((x / width) * shownPeaks);
      const to = Math.max(from + 1, Math.floor(((x + 1) / width) * shownPeaks));
      let peak = 0;
      for (let index = from; index < to; index += 1) {
        peak = Math.max(peak, peaks[index] ?? 0);
      }
      const barHeight = Math.max(1, peak * height);
      context.fillRect(x, (height - barHeight) / 2, 1, barHeight);
    }
  });

  return (
    <div
      aria-label={`Recording, ${formatDuration(durationSeconds)}`}
      className={`live-recording-clip ${take.ended ? "live-recording-clip--ended" : ""}`}
      data-live-recording-track-id={take.trackId}
      role="img"
      style={{ left: leftPx, width: widthPx }}
    >
      {tileCount ? (
        <div aria-hidden="true" className="live-recording-clip__filmstrip">
          {Array.from({ length: tileCount }, (_, index) => {
            const frame = liveFrameAt(
              monitor.frames,
              pxPerSecond ? (index * tileWidthPx) / pxPerSecond : 0,
            );
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: tiles are positions along the clip
                key={index}
                className="live-recording-clip__tile"
                style={{
                  left: index * tileWidthPx,
                  width: tileWidthPx,
                  backgroundImage: frame ? `url(${frame.url})` : undefined,
                }}
              />
            );
          })}
        </div>
      ) : null}
      {take.hasAudio ? (
        <canvas className="live-recording-clip__waveform" ref={canvasRef} />
      ) : null}
      <div className="live-recording-clip__body">
        <span className="live-recording-clip__badge">REC</span>
        <small>{formatDuration(durationSeconds)}</small>
      </div>
    </div>
  );
}
