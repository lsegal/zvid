// Draws a text clip into a canvas the size of its box with Canvas 2D: fill
// (solid or gradient), optional stroke outline, drop shadow, underline and
// strikethrough. Preview and export both upload the result as the layer's
// texture, so they draw identically.

import { formatCssColor, type GradientStop } from "./fill-paint.ts";
import { type FontFace, formatFontSpec } from "./text-fonts.ts";
import { layoutText, type TextLayout } from "./text-layout.ts";
import { MIN_FONT_SIZE, type TextPaint, type TextStyle } from "./text-style.ts";

export type TextCanvas = OffscreenCanvas | HTMLCanvasElement;

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function createTextCanvas(
  width: number,
  height: number,
): TextCanvas | undefined {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return undefined;
}

// Canvas `letterSpacing` is newer than the rest of Canvas 2D. Without it,
// characters are drawn one at a time.
function supportsLetterSpacing(context: Context2D) {
  return "letterSpacing" in context;
}

function setLetterSpacing(context: Context2D, pixels: number) {
  if (supportsLetterSpacing(context)) {
    context.letterSpacing = `${pixels}px`;
  }
}

// CSS gradient geometry: a linear gradient runs through the box centre at
// its angle, just long enough to reach the far corners; a radial one reaches
// the farthest corner.
function createPaintStyle(
  context: Context2D,
  paint: TextPaint,
  width: number,
  height: number,
) {
  if (paint.kind === "solid") {
    return formatCssColor(paint.color);
  }
  const centerX = width / 2;
  const centerY = height / 2;
  let gradient: CanvasGradient;
  if (paint.kind === "linear") {
    const radians = (paint.angleDeg * Math.PI) / 180;
    const sin = Math.sin(radians);
    const cos = Math.cos(radians);
    const half = (Math.abs(width * sin) + Math.abs(height * cos)) / 2;
    gradient = context.createLinearGradient(
      centerX - sin * half,
      centerY + cos * half,
      centerX + sin * half,
      centerY - cos * half,
    );
  } else {
    gradient = context.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      Math.hypot(centerX, centerY),
    );
  }
  for (const stop of paint.stops as GradientStop[]) {
    gradient.addColorStop(stop.offset, formatCssColor(stop.color));
  }
  return gradient;
}

// Lays the style's text out in a `width` × `height` box, measuring with
// the context in the face at each size tried.
export function layoutTextStyle(
  context: Context2D,
  style: TextStyle,
  face: FontFace,
  width: number,
  height: number,
  scale: number,
): TextLayout {
  let measuredSize = Number.NaN;
  setLetterSpacing(context, 0);
  return layoutText(
    {
      text: style.allCaps ? style.text.toUpperCase() : style.text,
      fontSize: style.fontSize * scale,
      minFontSize: MIN_FONT_SIZE * scale,
      resizeToFit: style.resizeToFit,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      align: style.align,
      verticalAlign: style.verticalAlign,
      width,
      height,
      padding: style.padding * scale,
    },
    (text, fontSize) => {
      if (fontSize !== measuredSize) {
        context.font = formatFontSpec(face, fontSize);
        measuredSize = fontSize;
      }
      return context.measureText(text).width;
    },
  );
}

type Run = { text: string; x: number; baseline: number };

// Draws a run of text left-aligned at `x`, a character at a time where the
// context can't space letters itself.
function drawRun(
  context: Context2D,
  run: Run,
  spacing: number,
  mode: "fill" | "stroke",
) {
  const draw = (text: string, x: number) =>
    mode === "fill"
      ? context.fillText(text, x, run.baseline)
      : context.strokeText(text, x, run.baseline);
  if (!spacing || supportsLetterSpacing(context)) {
    draw(run.text, run.x);
    return;
  }
  let x = run.x;
  for (const character of run.text) {
    draw(character, x);
    x += context.measureText(character).width + spacing;
  }
}

/**
 * Draws the text into `canvas`, sized to the box (`width` × `height`
 * pixels). `scale` converts the style's 1080p pixel sizes to the output.
 */
export function drawText(
  canvas: TextCanvas,
  style: TextStyle,
  face: FontFace,
  width: number,
  height: number,
  scale: number,
) {
  const context = canvas.getContext("2d") as Context2D | null;
  if (!context) {
    return undefined;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  const layout = layoutTextStyle(context, style, face, width, height, scale);
  const { fontSize, lineHeight } = layout;
  const spacing = style.letterSpacing * fontSize;
  context.font = formatFontSpec(face, fontSize);
  setLetterSpacing(context, spacing);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  // Lines sit centred in their line box on the font's own ascent and descent.
  const metrics = context.measureText("Hg");
  const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics.fontBoundingBoxDescent || fontSize * 0.2;
  const runs: Run[] = [];
  const decorations: Array<{ x: number; y: number; width: number }> = [];
  const thickness = Math.max(1, fontSize * 0.06);
  for (const line of layout.lines) {
    const baseline = line.y + (lineHeight - ascent - descent) / 2 + ascent;
    if (line.words) {
      for (const word of line.words) {
        runs.push({ text: word.text, x: word.x, baseline });
      }
    } else {
      runs.push({ text: line.text, x: line.x, baseline });
    }
    if (!line.text) {
      continue;
    }
    if (style.underline) {
      decorations.push({
        x: line.x,
        y: baseline + fontSize * 0.1,
        width: line.width,
      });
    }
    if (style.strikethrough) {
      decorations.push({
        x: line.x,
        y: baseline - fontSize * 0.3,
        width: line.width,
      });
    }
  }

  const applyShadow = (on: boolean) => {
    const shadow = on ? style.shadow : undefined;
    context.shadowColor = shadow ? formatCssColor(shadow.color) : "transparent";
    context.shadowBlur = shadow ? shadow.blur * scale : 0;
    context.shadowOffsetX = shadow ? shadow.offsetX * scale : 0;
    context.shadowOffsetY = shadow ? shadow.offsetY * scale : 0;
  };

  // The stroke is centred on the outline and the fill covers its inner
  // half, so the visible outline is the stroke width. The shadow is cast by
  // whichever is drawn first, so it is only drawn once.
  if (style.stroke) {
    applyShadow(true);
    context.strokeStyle = formatCssColor(style.stroke.color);
    context.lineWidth = style.stroke.width * scale * 2;
    context.lineJoin = "round";
    for (const run of runs) {
      drawRun(context, run, spacing, "stroke");
    }
    for (const line of decorations) {
      context.strokeRect(line.x, line.y - thickness / 2, line.width, thickness);
    }
  }
  applyShadow(!style.stroke);
  context.fillStyle = createPaintStyle(context, style.paint, width, height);
  for (const run of runs) {
    drawRun(context, run, spacing, "fill");
  }
  for (const line of decorations) {
    context.fillRect(line.x, line.y - thickness / 2, line.width, thickness);
  }
  applyShadow(false);
  return layout;
}
