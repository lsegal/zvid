import { useEffect, useRef } from "react";
import {
  type FrameSample,
  previewFrameAnalysis,
} from "../../../fx-shaders/frame-analysis";
import { useOnScreen } from "../FxTraceGraph";
import type { FxParameterControlProps } from "../types";
import { WAVEFORM_MAX_LEVEL, WAVEFORM_TICKS, waveformPixels } from "./waveform";
import "./waveform-control.css";

// The scope's size in CSS pixels, its width matching waveform-control.css and
// its height by the device's layout, and the room its plot leaves for the level
// labels on the left. The closest labels can be and all still read.
const WIDTH = 288;
const HEIGHTS = [168, 136, 112, 88];
const MIN_LABEL_SPACING = 12;
const LABEL_WIDTH = 30;
const PADDING = 6;
const GRATICULE = "rgba(242, 209, 75, 0.55)";

// Draws the scale and, when there is one, `sample`'s waveform.
function drawScope(
  canvas: HTMLCanvasElement,
  plot: HTMLCanvasElement,
  sample: FrameSample | null,
  height: number,
) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const scale = canvas.width / WIDTH;
  const left = LABEL_WIDTH;
  const top = PADDING;
  const plotWidth = WIDTH - left - PADDING;
  const plotHeight = height - 2 * PADDING;
  const labelEvery =
    plotHeight / (WAVEFORM_TICKS.length - 1) < MIN_LABEL_SPACING ? 2 : 1;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.fillStyle = "#000";
  context.fillRect(0, 0, WIDTH, height);

  if (sample) {
    const rows = Math.round(plotHeight * scale);
    plot.width = sample.width;
    plot.height = rows;
    plot
      .getContext("2d")
      ?.putImageData(
        new ImageData(waveformPixels(sample, rows), sample.width, rows),
        0,
        0,
      );
    context.imageSmoothingEnabled = true;
    context.drawImage(plot, left, top, plotWidth, plotHeight);
  }

  context.strokeStyle = GRATICULE;
  context.fillStyle = GRATICULE;
  context.lineWidth = 1 / scale;
  context.font = "9px system-ui, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const [index, level] of WAVEFORM_TICKS.entries()) {
    const y = top + plotHeight * (1 - level / WAVEFORM_MAX_LEVEL);
    context.setLineDash(level === 512 ? [3, 3] : []);
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(left + plotWidth, y);
    context.stroke();
    if (index % labelEvery === 0) {
      context.fillText(String(level), left - 4, y);
    }
  }
  context.setLineDash([]);
}

// Scopes' view of the picture at its position in the stack: an overlaid RGB
// waveform on a 0-1023 scale. It is only sampled while it is on screen and
// its device is on.
export function WaveformControl({
  device,
  parameter,
  layout = 0,
}: FxParameterControlProps) {
  const height = HEIGHTS[layout] ?? HEIGHTS[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plotRef = useRef<HTMLCanvasElement | null>(null);
  const onScreen = useOnScreen(canvasRef);
  const sampling = onScreen && device.enabled;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    plotRef.current ??= document.createElement("canvas");
    const plot = plotRef.current;
    const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = WIDTH * scale;
    canvas.height = height * scale;
    drawScope(canvas, plot, null, height);
    if (!sampling) {
      return;
    }
    return previewFrameAnalysis.subscribe(device.id, (sample) => {
      drawScope(canvas, plot, sample, height);
      canvas.dataset.sampled = "true";
    });
  }, [device.id, height, sampling]);

  return (
    <div className="fx-waveform" data-fx-no-drag>
      <canvas
        aria-label={`${parameter.label} of ${device.name}`}
        className="fx-waveform__scope"
        ref={canvasRef}
        role="img"
        style={{ height }}
      />
    </div>
  );
}
