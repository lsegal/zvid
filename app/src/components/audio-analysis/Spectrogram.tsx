import { useEffect, useRef } from "react";
import {
  formatFrequency,
  frequencyToPosition,
  mergeChannelsDb,
  SPECTROGRAM_COLUMNS_PER_SECOND,
  SPECTROGRAM_TICKS_HZ,
  SpectrogramClock,
  spectrogramColors,
  spectrumColumn,
} from "../../app/spectrogram";
import type { MasterMeterTap } from "../../fx-shaders/audio-bands";

type SpectrogramProps = {
  isPlaying: boolean;
  // The program mix to analyze; see VuMeter.
  getMeterTap: () => MasterMeterTap | null;
};

const COLORS = spectrogramColors();
const BACKGROUND = `rgb(${COLORS[0]}, ${COLORS[1]}, ${COLORS[2]})`;

// Spectra from both channels of a tap, merged.
class TapSpectrum {
  private tap: MasterMeterTap | null = null;
  private left = new Float32Array(0);
  private right = new Float32Array(0);
  private merged = new Float32Array(0);

  read(tap: MasterMeterTap) {
    if (tap !== this.tap) {
      this.tap = tap;
      const bins = tap.left.frequencyBinCount;
      this.left = new Float32Array(bins);
      this.right = new Float32Array(bins);
      this.merged = new Float32Array(bins);
    }
    if (tap.left.context.state !== "running") {
      return null;
    }
    tap.left.getFloatFrequencyData(this.left);
    tap.right.getFloatFrequencyData(this.right);
    return {
      bins: mergeChannelsDb(this.left, this.right, this.merged),
      binHz: tap.left.context.sampleRate / tap.left.fftSize,
    };
  }
}

function fillBackground(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// A scrolling spectrogram of the program mix: the newest audio at the right
// edge, frequency up the side on a log scale, and energy as color. It
// scrolls while playing and holds its picture when playback stops.
export function Spectrogram({ isPlaying, getMeterTap }: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clockRef = useRef(new SpectrogramClock());
  const spectrumRef = useRef(new TapSpectrum());

  // The canvas matches its box in device pixels; resizing starts it afresh.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        fillBackground(canvas);
      }
    };
    fillBackground(canvas);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const clock = clockRef.current;
    clock.restart();
    let column = new Float32Array(0);
    let frame = 0;

    const tick = (nowMs: number) => {
      frame = window.requestAnimationFrame(tick);
      const { width, height } = canvas;
      const ratio = window.devicePixelRatio || 1;
      const columns = Math.min(
        width,
        clock.advance(nowMs, SPECTROGRAM_COLUMNS_PER_SECOND * ratio),
      );
      if (!columns) {
        return;
      }
      if (column.length !== height) {
        column = new Float32Array(height);
      }
      const tap = getMeterTap();
      const spectrum = tap ? spectrumRef.current.read(tap) : null;
      if (spectrum) {
        spectrumColumn(spectrum.bins, spectrum.binHz, column);
      } else {
        column.fill(0);
      }
      const image = context.createImageData(columns, height);
      for (let row = 0; row < height; row++) {
        const color = Math.round(column[row] * 255) * 4;
        for (let x = 0; x < columns; x++) {
          image.data.set(
            COLORS.subarray(color, color + 4),
            (row * columns + x) * 4,
          );
        }
      }
      context.drawImage(canvas, -columns, 0);
      context.putImageData(image, width - columns, 0);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [getMeterTap, isPlaying]);

  return (
    <div className="spectrogram">
      <canvas
        aria-label="Spectrogram of the master output"
        className="spectrogram__canvas"
        ref={canvasRef}
        role="img"
      />
      {SPECTROGRAM_TICKS_HZ.map((hz) => (
        <span
          aria-hidden="true"
          className="spectrogram__tick"
          key={hz}
          style={{ bottom: `${frequencyToPosition(hz) * 100}%` }}
        >
          {formatFrequency(hz)}
        </span>
      ))}
    </div>
  );
}
