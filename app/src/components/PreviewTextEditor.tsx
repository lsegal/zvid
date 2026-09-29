import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Size } from "../preview-edit.ts";
import {
  formatCssMatrix,
  formatTextPaintCss,
  resolveTextEditorKey,
  resolveTextEditorTypography,
  type TextEditorKeyAction,
  type TextEditorPlacement,
  textScaleForCanvas,
} from "../preview-text-edit.ts";
import {
  formatFontFamily,
  loadFontFace,
  resolveFontFace,
  subscribeFonts,
} from "../text-fonts.ts";
import { createTextCanvas, layoutTextStyle } from "../text-render.ts";
import { DEFAULT_TEXT, type TextStyle } from "../text-style.ts";
import "./preview-text-editor.css";
import { formatCssColor } from "../fill-paint.ts";

// Clicks here keep the editor open: the editor itself, the FX panel (whose
// changes show in the editor straight away) and the popovers and dialogs it
// opens, such as the font list and colour pickers.
const EDITING_SCOPE_SELECTOR = [
  ".preview-text-editor",
  ".fx-panel",
  "[data-radix-popper-content-wrapper]",
  '[role="dialog"]',
].join(", ");

function isInEditingScope(target: EventTarget | null) {
  return (
    target instanceof Element && target.closest(EDITING_SCOPE_SELECTOR) !== null
  );
}

type MeasureContext =
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D;

let measureContext: MeasureContext | null | undefined;

function getMeasureContext() {
  if (measureContext === undefined) {
    measureContext =
      (createTextCanvas(1, 1)?.getContext("2d") as MeasureContext | null) ??
      null;
  }
  return measureContext;
}

export const TEXT_EDITOR_TITLE =
  "Esc or Ctrl/Cmd+Enter to finish. Ctrl/Cmd+B, I, U and Ctrl/Cmd+Shift+> / < style the whole text layer; per-character styling isn't supported.";

// Types a text layer's text directly on the canvas. The text area sits over
// the layer's transformed box, laid out in canvas pixels with the layer's
// font, size (after Resize to fit), leading, tracking, alignment and paint,
// so what is typed lines up with the final render. The compositor hides the
// layer's rendered text meanwhile, so it never shows twice.
export function PreviewTextEditor({
  canvas,
  placement,
  style,
  onChangeText,
  onAction,
}: {
  canvas: Size;
  placement: TextEditorPlacement;
  style: TextStyle;
  onChangeText: (text: string) => void;
  onAction: (action: TextEditorKeyAction) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(style.text);
  // The last text sent from here, so edits made elsewhere (the FX panel's
  // Text field, a collaborator) replace the draft but echoes of typing don't.
  const sentRef = useRef(style.text);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    if (style.text !== sentRef.current) {
      sentRef.current = style.text;
      setDraft(style.text);
    }
  }, [style.text]);

  // New text layers start as "Text", which typing replaces; otherwise the
  // caret goes to the end.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    if (input.value === DEFAULT_TEXT) {
      input.select();
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, []);

  // A click outside the box (and outside the FX panel) finishes editing.
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!isInEditingScope(event.target)) {
        onActionRef.current({ kind: "commit" });
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, []);

  const face = resolveFontFace(style.font, style.weight, style.italic);
  const faceKey = JSON.stringify(face);
  // Re-lays the text out once the face loads, as the compositor redraws.
  const [fontsVersion, setFontsVersion] = useState(0);
  useEffect(
    () => subscribeFonts(() => setFontsVersion((version) => version + 1)),
    [],
  );
  useEffect(() => {
    void loadFontFace(JSON.parse(faceKey));
  }, [faceKey]);

  const scale = textScaleForCanvas(canvas);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fontsVersion re-measures once a face loads
  const layout = useMemo(() => {
    const context = getMeasureContext();
    return context
      ? layoutTextStyle(
          context,
          { ...style, text: draft },
          JSON.parse(faceKey),
          placement.width,
          placement.height,
          scale,
        )
      : undefined;
  }, [
    draft,
    faceKey,
    fontsVersion,
    placement.height,
    placement.width,
    scale,
    style,
  ]);

  const typography = resolveTextEditorTypography(
    style,
    layout ?? {
      fontSize: style.fontSize * scale,
      lineHeight: style.fontSize * scale * style.lineHeight,
      lines: [],
    },
    scale,
  );
  const paint = formatTextPaintCss(style.paint);
  const decorations = [
    style.underline ? "underline" : "",
    style.strikethrough ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const shadow = style.shadow
    ? `${style.shadow.offsetX * scale}px ${style.shadow.offsetY * scale}px ${style.shadow.blur * scale}px ${formatCssColor(style.shadow.color)}`
    : undefined;
  const inputStyle: CSSProperties = {
    fontFamily: formatFontFamily(face),
    fontSize: `${typography.fontSize}px`,
    fontWeight: face.weight,
    fontStyle: face.italic ? "italic" : "normal",
    lineHeight: `${typography.lineHeight}px`,
    letterSpacing: `${typography.letterSpacing}px`,
    padding: `${typography.paddingTop}px ${typography.paddingX}px ${typography.paddingX}px`,
    textAlign: style.align,
    textTransform: style.allCaps ? "uppercase" : "none",
    textDecorationLine: decorations || "none",
    textDecorationThickness: `${typography.decorationThickness}px`,
    ...(style.paint.kind === "solid"
      ? { color: paint }
      : {
          color: "transparent",
          backgroundImage: paint,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
        }),
    caretColor:
      style.paint.kind === "solid"
        ? paint
        : formatCssColor(
            style.paint.stops[0]?.color ?? { r: 255, g: 255, b: 255, a: 1 },
          ),
    WebkitTextStroke: style.stroke
      ? `${typography.strokeWidth}px ${formatCssColor(style.stroke.color)}`
      : undefined,
    // A text shadow paints over a gradient clipped to the text, so a
    // gradient casts its shadow through a filter instead.
    ...(shadow
      ? style.paint.kind === "solid"
        ? { textShadow: shadow }
        : { filter: `drop-shadow(${shadow})` }
      : {}),
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // The preview's own keys (arrow nudges, Esc to deselect) and the app's
    // shortcuts never see typing.
    event.stopPropagation();
    // Keys that end or cancel an IME composition belong to it.
    if (event.nativeEvent.isComposing) {
      return;
    }

    const action = resolveTextEditorKey(event);
    if (action) {
      event.preventDefault();
      onAction(action);
    }
  };

  return (
    <div
      className="preview-text-editor"
      data-testid="preview-text-editor"
      style={{
        width: placement.width,
        height: placement.height,
        transform: formatCssMatrix(placement.matrix),
      }}
    >
      <textarea
        ref={inputRef}
        className="preview-text-editor__input"
        aria-label="Text"
        title={TEXT_EDITOR_TITLE}
        placeholder={DEFAULT_TEXT}
        spellCheck={false}
        value={draft}
        style={inputStyle}
        onChange={(event) => {
          sentRef.current = event.target.value;
          setDraft(event.target.value);
          onChangeText(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          // Tabbing away finishes editing, like a click outside.
          if (event.relatedTarget && !isInEditingScope(event.relatedTarget)) {
            onAction({ kind: "commit" });
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
