import { useLayoutEffect, useRef } from "react";
import { getPeakRange, type WaveformPeaks } from "./waveform-peaks";

type MasterWaveformProps = {
  peaks: WaveformPeaks;
  bpm: number;
  quarterPx: number;
  visibleStartPx: number;
  visibleWidthPx: number;
};

// Draws only the visible slice of the lane so the canvas stays small at any
// zoom level; x positions use the same quarter scale as the clip lanes.
export function MasterWaveform({
  peaks,
  bpm,
  quarterPx,
  visibleStartPx,
  visibleWidthPx,
}: MasterWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(0, Math.round(visibleWidthPx * pixelRatio));
    const height = Math.max(0, Math.round(canvas.clientHeight * pixelRatio));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    if (!width || !height || quarterPx <= 0 || bpm <= 0) {
      return;
    }

    const secondsPerColumn = 60 / (bpm * quarterPx * pixelRatio);
    const startSeconds = (visibleStartPx * 60) / (bpm * quarterPx);
    const middle = height / 2;
    const amplitude = Math.max(1, middle - 4 * pixelRatio);
    context.fillStyle = "rgba(214, 236, 245, 0.82)";

    for (let column = 0; column < width; column += 1) {
      const columnStart = startSeconds + column * secondsPerColumn;
      if (columnStart >= peaks.durationSeconds) {
        break;
      }

      const range = getPeakRange(
        peaks,
        columnStart,
        columnStart + secondsPerColumn,
      );
      if (!range) {
        break;
      }

      const top = middle - Math.min(1, range[1]) * amplitude;
      const bottom = middle - Math.max(-1, range[0]) * amplitude;
      // Silence collapses to a one-pixel center line.
      context.fillRect(column, top, 1, Math.max(1, bottom - top));
    }
  }, [bpm, peaks, quarterPx, visibleStartPx, visibleWidthPx]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform__canvas"
      style={{ left: visibleStartPx, width: visibleWidthPx }}
    />
  );
}
