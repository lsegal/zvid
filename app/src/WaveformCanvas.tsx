import { type CSSProperties, useLayoutEffect, useRef } from "react";
import {
  getWaveformSourceSpan,
  type WaveformSourceRange,
} from "./waveform-range.ts";
import { getPeakRange, type WaveformPeaks } from "./waveform-peaks";

type WaveformCanvasProps = {
  peaks: WaveformPeaks;
  range: WaveformSourceRange;
  // The slice to draw, in the range's pixels. The canvas sits at `startPx`
  // and is `widthPx` wide, so it stays small at any zoom level.
  startPx: number;
  widthPx: number;
  className: string;
  style?: CSSProperties;
};

// Draws the peaks of one slice of a source range: a column per device pixel,
// filled around a center line, the way the Audio lane draws.
export function WaveformCanvas({
  peaks,
  range,
  startPx,
  widthPx,
  className,
  style,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const {
    startSeconds,
    secondsPerPx,
    windowStartSeconds,
    windowEndSeconds,
    warp,
    bpm,
  } = range;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(0, Math.round(widthPx * pixelRatio));
    const height = Math.max(0, Math.round(canvas.clientHeight * pixelRatio));
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    if (!width || !height) {
      return;
    }

    const sliceRange = {
      startSeconds,
      secondsPerPx,
      windowStartSeconds,
      windowEndSeconds,
      warp,
      bpm,
    };
    const middle = height / 2;
    const amplitude = Math.max(1, middle - 4 * pixelRatio);
    context.fillStyle = "rgba(214, 236, 245, 0.82)";

    for (let column = 0; column < width; column += 1) {
      const span = getWaveformSourceSpan(
        sliceRange,
        startPx + column / pixelRatio,
        startPx + (column + 1) / pixelRatio,
      );
      const peakRange =
        span && span[0] < peaks.durationSeconds
          ? getPeakRange(peaks, span[0], span[1])
          : null;
      if (!peakRange) {
        continue;
      }

      const top = middle - Math.min(1, peakRange[1]) * amplitude;
      const bottom = middle - Math.max(-1, peakRange[0]) * amplitude;
      // Silence collapses to a one-pixel center line.
      context.fillRect(column, top, 1, Math.max(1, bottom - top));
    }
  }, [
    bpm,
    peaks,
    secondsPerPx,
    startPx,
    startSeconds,
    warp,
    widthPx,
    windowEndSeconds,
    windowStartSeconds,
  ]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ ...style, left: startPx, width: widthPx }}
    />
  );
}
