// Draws a text clip into a canvas the size of its box with Canvas 2D: fill
// (solid or gradient), optional solid or dashed stroke outline, drop shadow,
// underline and strikethrough. Preview and export both upload the result as the layer's
// texture, so they draw identically.

import { formatCssColor, type GradientStop } from "./fill-paint.ts";
import { type FontFace, formatFontSpec } from "./text-fonts.ts";
import { layoutText, type TextLayout } from "./text-layout.ts";
import { type CircleTextLayout, layoutCircleText } from "./text-path.ts";
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

type Point = [x: number, y: number];

// CSS gradient geometry: a linear gradient runs through the box center at
// its angle, just long enough to reach the far corners; a radial one reaches
// the farthest corner. `toLocal` maps box points into the context's current
// transform, so a rotated glyph still shows its part of the box's gradient.
function createPaintStyle(
  context: Context2D,
  paint: TextPaint,
  width: number,
  height: number,
  toLocal: (point: Point) => Point = (point) => point,
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
    const [x0, y0] = toLocal([centerX - sin * half, centerY + cos * half]);
    const [x1, y1] = toLocal([centerX + sin * half, centerY - cos * half]);
    gradient = context.createLinearGradient(x0, y0, x1, y1);
  } else {
    const [x, y] = toLocal([centerX, centerY]);
    gradient = context.createRadialGradient(
      x,
      y,
      0,
      x,
      y,
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
  if (style.path === "circle") {
    return drawCircleText(context, style, face, width, height, scale);
  }
  const layout = layoutTextStyle(context, style, face, width, height, scale);
  const { fontSize, lineHeight } = layout;
  const spacing = style.letterSpacing * fontSize;
  context.font = formatFontSpec(face, fontSize);
  setLetterSpacing(context, spacing);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  // Lines sit centered in their line box on the font's own ascent and descent.
  const { ascent, descent } = measureFontBox(context, fontSize);
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

  const applyShadow = (on: boolean) =>
    setShadow(context, on ? style.shadow : undefined, scale);

  // The stroke is centered on the outline and the fill covers its inner
  // half, so the visible outline is the stroke width. The shadow is cast by
  // whichever is drawn first, so it is only drawn once.
  if (style.stroke) {
    applyShadow(true);
    context.strokeStyle = formatCssColor(style.stroke.color);
    context.lineWidth = style.stroke.width * scale * 2;
    context.lineJoin = "round";
    setStrokeDash(context, style.stroke, scale);
    for (const run of runs) {
      drawRun(context, run, spacing, "stroke");
    }
    for (const line of decorations) {
      context.strokeRect(line.x, line.y - thickness / 2, line.width, thickness);
    }
    setStrokeDash(context, undefined, scale);
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

// The font's own ascent and descent at the context's current font.
function measureFontBox(context: Context2D, fontSize: number) {
  const metrics = context.measureText("Hg");
  return {
    ascent: metrics.fontBoundingBoxAscent || fontSize * 0.8,
    descent: metrics.fontBoundingBoxDescent || fontSize * 0.2,
  };
}

// Dashes the context's strokes as the style's stroke asks, or makes them
// solid. Each glyph run starts the pattern afresh.
function setStrokeDash(
  context: Context2D,
  stroke: TextStyle["stroke"],
  scale: number,
) {
  const dash = stroke?.dash;
  context.setLineDash(dash ? [dash.length * scale, dash.gap * scale] : []);
  context.lineDashOffset = dash ? dash.offset * scale : 0;
}

function setShadow(
  context: Context2D,
  shadow: TextStyle["shadow"],
  scale: number,
) {
  context.shadowColor = shadow ? formatCssColor(shadow.color) : "transparent";
  context.shadowBlur = shadow ? shadow.blur * scale : 0;
  context.shadowOffsetX = shadow ? shadow.offsetX * scale : 0;
  context.shadowOffsetY = shadow ? shadow.offsetY * scale : 0;
}

// Draws the text round a circle centered in the box, each character upright
// to the circle. Vertical places it against the circle: Top sits on it,
// Middle centers on it and Bottom hangs inside it.
function drawCircleText(
  context: Context2D,
  style: TextStyle,
  face: FontFace,
  width: number,
  height: number,
  scale: number,
): CircleTextLayout {
  const radius = style.pathRadius * scale;
  let measuredSize = Number.NaN;
  setLetterSpacing(context, 0);
  const layout = layoutCircleText(
    {
      text: style.allCaps ? style.text.toUpperCase() : style.text,
      fontSize: style.fontSize * scale,
      minFontSize: MIN_FONT_SIZE * scale,
      resizeToFit: style.resizeToFit,
      letterSpacing: style.letterSpacing,
      align: style.align,
      radius,
    },
    (text, fontSize) => {
      if (fontSize !== measuredSize) {
        context.font = formatFontSpec(face, fontSize);
        measuredSize = fontSize;
      }
      return context.measureText(text).width;
    },
  );
  const { fontSize } = layout;
  context.font = formatFontSpec(face, fontSize);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  const { ascent, descent } = measureFontBox(context, fontSize);
  const baseline =
    style.verticalAlign === "top"
      ? radius
      : style.verticalAlign === "bottom"
        ? radius - ascent
        : radius - (ascent - descent) / 2;
  const centerX = width / 2;
  const centerY = height / 2;
  const thickness = Math.max(1, fontSize * 0.06);
  const decorations = [
    ...(style.underline ? [baseline - fontSize * 0.1] : []),
    ...(style.strikethrough ? [baseline + fontSize * 0.3] : []),
  ];

  // Shadow offsets ignore the context's transform, so they stay in the box.
  const applyShadow = (on: boolean) =>
    setShadow(context, on ? style.shadow : undefined, scale);
  const drawGlyphs = (mode: "fill" | "stroke", shadow: boolean) => {
    applyShadow(shadow);
    for (const glyph of layout.glyphs) {
      const rotation = glyph.angle + Math.PI / 2;
      context.setTransform(1, 0, 0, 1, centerX, centerY);
      context.rotate(rotation);
      if (mode === "fill") {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        context.fillStyle = createPaintStyle(
          context,
          style.paint,
          width,
          height,
          ([x, y]) => [
            (x - centerX) * cos + (y - centerY) * sin,
            (y - centerY) * cos - (x - centerX) * sin,
          ],
        );
        context.fillText(glyph.text, -glyph.width / 2, -baseline);
      } else {
        context.strokeText(glyph.text, -glyph.width / 2, -baseline);
      }
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
  };
  const drawDecorations = (lineWidth: number, shadow: boolean) => {
    applyShadow(shadow);
    context.lineWidth = lineWidth;
    context.lineCap = "butt";
    for (const decoration of decorations) {
      context.beginPath();
      context.arc(
        centerX,
        centerY,
        Math.max(0, decoration),
        layout.startAngle,
        layout.startAngle + layout.sweep,
      );
      context.stroke();
    }
  };

  // As on straight text, the stroke goes under the fill and whichever is
  // drawn first casts the shadow.
  if (style.stroke) {
    context.strokeStyle = formatCssColor(style.stroke.color);
    context.lineWidth = style.stroke.width * scale * 2;
    context.lineJoin = "round";
    setStrokeDash(context, style.stroke, scale);
    drawGlyphs("stroke", true);
    drawDecorations(thickness + style.stroke.width * scale * 2, true);
    setStrokeDash(context, undefined, scale);
  }
  drawGlyphs("fill", !style.stroke);
  context.strokeStyle = createPaintStyle(context, style.paint, width, height);
  drawDecorations(thickness, !style.stroke);
  setShadow(context, undefined, scale);
  return layout;
}
