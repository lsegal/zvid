import type { FrameSample } from "../../fx-shaders/frame-analysis.ts";
import { WAVEFORM_MAX_LEVEL, WAVEFORM_TICKS } from "../fx/controls/waveform.ts";
import { chromaOf, type ScopeKind, scopeImage } from "./scope-pixels.ts";

const GRATICULE = "rgba(242, 209, 75, 0.55)";
const LABEL = "rgba(242, 209, 75, 0.8)";
// Room for the level labels left of a waveform, and around every plot.
const LABEL_WIDTH = 30;
const PADDING = 8;

// The vectorscope's targets: each primary and secondary at 75%, Lumetri's
// boxes, with the label drawn beside it.
const VECTORSCOPE_TARGETS = [
  { label: "R", rgb: [0.75, 0, 0] },
  { label: "Mg", rgb: [0.75, 0, 0.75] },
  { label: "B", rgb: [0, 0, 0.75] },
  { label: "Cy", rgb: [0, 0.75, 0.75] },
  { label: "G", rgb: [0, 0.75, 0] },
  { label: "Yl", rgb: [0.75, 0.75, 0] },
] as const;

// The skin-tone line, about 123° counterclockwise from the Cb axis.
const SKIN_TONE_ANGLE = (123 * Math.PI) / 180;

// The vectorscope's plot images are at most this many cells across.
const MAX_VECTORSCOPE_CELLS = 256;

type Rect = { x: number; y: number; width: number; height: number };

// Puts `sample`'s `kind` image, `rows` tall, into `area` of `context`,
// with `plot` as scratch.
function drawImage(
  context: CanvasRenderingContext2D,
  plot: HTMLCanvasElement,
  kind: ScopeKind,
  sample: FrameSample,
  area: Rect,
  rows: number,
) {
  const image = scopeImage(kind, sample, Math.max(1, rows));
  plot.width = image.width;
  plot.height = image.height;
  plot
    .getContext("2d")
    ?.putImageData(
      new ImageData(image.pixels, image.width, image.height),
      0,
      0,
    );
  context.imageSmoothingEnabled = true;
  context.drawImage(plot, area.x, area.y, area.width, area.height);
}

function drawLevels(context: CanvasRenderingContext2D, area: Rect) {
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const level of WAVEFORM_TICKS) {
    const y = area.y + area.height * (1 - level / WAVEFORM_MAX_LEVEL);
    context.setLineDash(level === 512 ? [3, 3] : []);
    context.beginPath();
    context.moveTo(area.x, y);
    context.lineTo(area.x + area.width, y);
    context.stroke();
    context.fillText(String(level), area.x - 4, y);
  }
  context.setLineDash([]);
}

function drawParadeDividers(context: CanvasRenderingContext2D, area: Rect) {
  context.textAlign = "center";
  context.textBaseline = "top";
  for (let channel = 0; channel < 3; channel++) {
    const x = area.x + (area.width * channel) / 3;
    if (channel) {
      context.beginPath();
      context.moveTo(x, area.y);
      context.lineTo(x, area.y + area.height);
      context.stroke();
    }
    context.fillText("RGB"[channel], x + area.width / 6, area.y + 2);
  }
}

function drawHistogramScale(context: CanvasRenderingContext2D, area: Rect) {
  context.textAlign = "center";
  context.textBaseline = "top";
  for (const share of [0, 0.25, 0.5, 0.75, 1]) {
    const x = area.x + area.width * share;
    context.beginPath();
    context.moveTo(x, area.y);
    context.lineTo(x, area.y + area.height);
    context.stroke();
    context.fillText(
      String(Math.round(share * 255)),
      Math.min(Math.max(x, area.x + 8), area.x + area.width - 8),
      area.y + area.height + 2,
    );
  }
}

function drawVectorscopeScale(context: CanvasRenderingContext2D, area: Rect) {
  const centerX = area.x + area.width / 2;
  const centerY = area.y + area.height / 2;
  const radius = area.width / 2;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  context.moveTo(area.x, centerY);
  context.lineTo(area.x + area.width, centerY);
  context.moveTo(centerX, area.y);
  context.lineTo(centerX, area.y + area.height);
  context.stroke();
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(centerX, centerY);
  context.lineTo(
    centerX + radius * Math.cos(SKIN_TONE_ANGLE),
    centerY - radius * Math.sin(SKIN_TONE_ANGLE),
  );
  context.stroke();
  context.setLineDash([]);
  context.textAlign = "center";
  context.textBaseline = "middle";
  const box = Math.max(6, area.width / 28);
  for (const { label, rgb } of VECTORSCOPE_TARGETS) {
    const { cb, cr } = chromaOf(...rgb);
    const x = centerX + cb * area.width;
    const y = centerY - cr * area.height;
    context.strokeRect(x - box / 2, y - box / 2, box, box);
    // Labels sit outside their boxes, away from the center.
    const away = Math.hypot(cb, cr) || 1;
    context.fillText(
      label,
      x + (cb / away) * box * 1.4,
      y - (cr / away) * box * 1.4,
    );
  }
}

// Draws `kind` of `sample`, or just its scale while there is no sample, on
// `canvas`, which is `width` × `height` CSS pixels at `scale` device pixels
// each. `plot` is a scratch canvas for the trace.
export function drawScope(
  canvas: HTMLCanvasElement,
  plot: HTMLCanvasElement,
  kind: ScopeKind,
  sample: FrameSample | null,
  { width, height, scale }: { width: number; height: number; scale: number },
) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  if (width <= 2 * PADDING + LABEL_WIDTH || height <= 2 * PADDING + 12) {
    return;
  }

  let area: Rect;
  if (kind === "vectorscope") {
    const side = Math.min(width, height) - 2 * PADDING;
    area = {
      x: (width - side) / 2,
      y: (height - side) / 2,
      width: side,
      height: side,
    };
  } else {
    const left = kind === "histogram" ? PADDING : LABEL_WIDTH;
    const bottom = kind === "histogram" ? PADDING + 12 : PADDING;
    area = {
      x: left,
      y: PADDING,
      width: width - left - PADDING,
      height: height - PADDING - bottom,
    };
  }

  if (sample) {
    const rows = Math.round(area.height * scale);
    drawImage(
      context,
      plot,
      kind,
      sample,
      area,
      kind === "vectorscope" ? Math.min(MAX_VECTORSCOPE_CELLS, rows) : rows,
    );
  }

  context.strokeStyle = GRATICULE;
  context.fillStyle = LABEL;
  context.lineWidth = 1 / scale;
  context.font = "9px system-ui, sans-serif";
  if (kind === "waveform") {
    drawLevels(context, area);
  } else if (kind === "parade") {
    drawLevels(context, area);
    drawParadeDividers(context, area);
  } else if (kind === "histogram") {
    drawHistogramScale(context, area);
  } else {
    drawVectorscopeScale(context, area);
  }
}
