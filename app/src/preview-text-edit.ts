// Pure pieces of live text editing in the preview monitor: where the
// on-canvas editor sits over a text layer's transformed box, the typography
// that makes typed text line up with the rendered text, the editor's
// keyboard shortcuts, and the Text effect edits they make.
//
// The editor is laid out in canvas pixels, the size of the layer's box, and a
// CSS matrix maps it onto the monitor, so it follows the layer's Transform
// (move, scale, rotation) exactly as the compositor draws it.
import {
  applyMatrix,
  frameBoxInCanvas,
  type Matrix2D,
  transformMatrix,
} from "./composition-transform.ts";
import { type FillPaint, formatFillPaintCss } from "./fill-paint.ts";
import {
  addEffect,
  type SessionEffect,
  setEffectEnabled,
  setEffectParameter,
} from "./fx-stack.ts";
import type { PreviewLayer, Rect, Size } from "./preview-edit.ts";
import type { TextLayout } from "./text-layout.ts";
import {
  isTextEffectName,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  readTextStyle,
  TEXT_EFFECT_NAME,
  TEXT_REFERENCE_HEIGHT,
  type TextPaint,
  type TextStyle,
  type TextStyleFlag,
  toggleStyleFlag,
} from "./text-style.ts";

export const TEXT_EDIT_HISTORY_LABEL = "Edit text";
export const TEXT_PARAMETER_KEY = "Text";
export const FONT_STYLE_PARAMETER_KEY = "FontStyle";
export const FONT_SIZE_PARAMETER_KEY = "FontSize";
// Ctrl/Cmd+Shift+> and < change the size by this many pixels at 1080p.
export const FONT_SIZE_STEP = 2;

// The editor's box in canvas pixels, and the matrix that maps it from its
// own top-left corner onto the monitor (CSS pixels, monitor top-left).
export type TextEditorPlacement = {
  width: number;
  height: number;
  matrix: Matrix2D;
};

export function resolveTextEditorPlacement(
  layer: Pick<PreviewLayer, "placement" | "transform">,
  video: Rect,
  canvas: Size,
): TextEditorPlacement {
  const box = frameBoxInCanvas(layer.placement.frame, canvas);
  const toCanvas = transformMatrix(layer.transform, box, canvas);
  const scaleX = video.width / Math.max(1, canvas.width);
  const scaleY = video.height / Math.max(1, canvas.height);
  // The editor's origin is the box's top-left corner, not the canvas's.
  const origin = applyMatrix(toCanvas, { x: box.x, y: box.y });
  return {
    width: box.width,
    height: box.height,
    matrix: {
      a: toCanvas.a * scaleX,
      b: toCanvas.b * scaleY,
      c: toCanvas.c * scaleX,
      d: toCanvas.d * scaleY,
      e: video.left + origin.x * scaleX,
      f: video.top + origin.y * scaleY,
    },
  };
}

export function formatCssMatrix({ a, b, c, d, e, f }: Matrix2D) {
  return `matrix(${[a, b, c, d, e, f].map((value) => Number(value.toFixed(6))).join(", ")})`;
}

// Text sizes are given at 1080p and scale with the canvas's short side, as
// the compositor draws them.
export function textScaleForCanvas(canvas: Size) {
  return Math.min(canvas.width, canvas.height) / TEXT_REFERENCE_HEIGHT;
}

// The editor's typography in canvas pixels, from the layout the compositor
// would draw (so Resize to fit shrinks the editor's text as it grows).
export type TextEditorTypography = {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  paddingTop: number;
  paddingX: number;
  strokeWidth: number;
  decorationThickness: number;
};

export function resolveTextEditorTypography(
  style: Pick<TextStyle, "letterSpacing" | "padding" | "stroke">,
  layout: Pick<TextLayout, "fontSize" | "lineHeight" | "lines">,
  scale: number,
): TextEditorTypography {
  const paddingX = style.padding * scale;
  return {
    fontSize: layout.fontSize,
    lineHeight: layout.lineHeight,
    letterSpacing: style.letterSpacing * layout.fontSize,
    // Vertical alignment places the first line; the rest follow it.
    paddingTop: Math.max(0, layout.lines[0]?.y ?? paddingX),
    paddingX,
    // The compositor strokes twice the width under the fill, so the
    // visible outline is the stroke width.
    strokeWidth: style.stroke ? style.stroke.width * scale * 2 : 0,
    decorationThickness: Math.max(1, layout.fontSize * 0.06),
  };
}

/** CSS paint for the editor's text: a colour, or a gradient to clip to it. */
export function formatTextPaintCss(paint: TextPaint) {
  return formatFillPaintCss({ ...paint, opacity: 1 } as FillPaint);
}

export type TextEditorKeyAction =
  | { kind: "commit" }
  | { kind: "style"; flag: TextStyleFlag }
  | { kind: "size"; direction: 1 | -1 };

type KeyLike = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

const STYLE_SHORTCUTS: Record<string, TextStyleFlag> = {
  b: "Bold",
  i: "Italic",
  u: "Underline",
};

// Esc and Ctrl/Cmd+Enter leave the editor; plain Enter is a new line.
// Ctrl/Cmd+B, I and U toggle the layer's style, Ctrl/Cmd+Shift+> and < change
// its size. Anything else is typing.
export function resolveTextEditorKey(
  event: KeyLike,
): TextEditorKeyAction | undefined {
  if (event.key === "Escape") {
    return { kind: "commit" };
  }

  const primary = event.ctrlKey || event.metaKey;
  if (!primary || event.altKey) {
    return undefined;
  }

  if (event.key === "Enter") {
    return { kind: "commit" };
  }

  if (event.shiftKey) {
    if (event.key === ">" || event.code === "Period") {
      return { kind: "size", direction: 1 };
    }
    if (event.key === "<" || event.code === "Comma") {
      return { kind: "size", direction: -1 };
    }
    return undefined;
  }

  const flag = STYLE_SHORTCUTS[event.key.toLowerCase()];
  return flag ? { kind: "style", flag } : undefined;
}

// The Text effect a layer's text clips draw with: its last enabled one, as
// in the compositor, or else its last bypassed one.
export function findLayerTextEffect(
  effects: readonly SessionEffect[],
  laneId: string,
) {
  const texts = effects.filter(
    (effect) =>
      effect.trackId === laneId && isTextEffectName(effect.effectName),
  );
  return (
    texts.findLast((effect) => effect.enabled !== false) ??
    texts[texts.length - 1]
  );
}

// Applies `update` to the layer's Text effect, first adding one with the
// registry defaults (with `newEffectId`) when the layer has none. A bypassed
// Text effect is turned back on so the edit shows. Returns `effects` itself
// when the layer can't take a Text effect.
function updateLayerTextEffect(
  effects: SessionEffect[],
  laneId: string,
  newEffectId: string,
  update: (effects: SessionEffect[], effect: SessionEffect) => SessionEffect[],
) {
  let result = effects;
  let effect = findLayerTextEffect(result, laneId);
  if (!effect) {
    result = addEffect(
      result,
      laneId,
      TEXT_EFFECT_NAME,
      undefined,
      newEffectId,
    );
    effect = findLayerTextEffect(result, laneId);
    if (!effect) {
      return effects;
    }
  }

  if (effect.enabled === false) {
    result = setEffectEnabled(result, effect.id, true);
  }
  return update(result, effect);
}

export function readLayerText(
  effects: readonly SessionEffect[],
  laneId: string,
) {
  return readTextStyle(findLayerTextEffect(effects, laneId)).text;
}

export function setLayerText(
  effects: SessionEffect[],
  laneId: string,
  text: string,
  newEffectId: string,
) {
  return updateLayerTextEffect(effects, laneId, newEffectId, (result, effect) =>
    setEffectParameter(result, effect.id, TEXT_PARAMETER_KEY, text),
  );
}

export function toggleLayerTextStyle(
  effects: SessionEffect[],
  laneId: string,
  flag: TextStyleFlag,
  newEffectId: string,
) {
  return updateLayerTextEffect(effects, laneId, newEffectId, (result, effect) =>
    setEffectParameter(
      result,
      effect.id,
      FONT_STYLE_PARAMETER_KEY,
      toggleStyleFlag(
        effect.parameters.find(
          (parameter) =>
            parameter.key.toLowerCase() ===
            FONT_STYLE_PARAMETER_KEY.toLowerCase(),
        )?.value,
        flag,
      ),
    ),
  );
}

export function stepLayerFontSize(
  effects: SessionEffect[],
  laneId: string,
  direction: 1 | -1,
  newEffectId: string,
) {
  return updateLayerTextEffect(effects, laneId, newEffectId, (result, effect) =>
    setEffectParameter(
      result,
      effect.id,
      FONT_SIZE_PARAMETER_KEY,
      Math.max(
        MIN_FONT_SIZE,
        Math.min(
          MAX_FONT_SIZE,
          readTextStyle(effect).fontSize + direction * FONT_SIZE_STEP,
        ),
      ),
    ),
  );
}
