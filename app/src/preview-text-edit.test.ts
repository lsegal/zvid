import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IDENTITY_TRANSFORM,
  layerBoxInCanvas,
} from "./composition-transform.ts";
import type { SessionEffect } from "./fx-stack.ts";
import {
  findClipTextEffect,
  formatCssMatrix,
  readClipText,
  resolveTextEditorKey,
  resolveTextEditorPlacement,
  resolveTextEditorTypography,
  setClipText,
  stepClipFontSize,
  textScaleForCanvas,
  toggleClipTextStyle,
} from "./preview-text-edit.ts";
import { layoutText } from "./text-layout.ts";
import { readTextStyle } from "./text-style.ts";

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < EPSILON,
    `expected ${actual} to be close to ${expected}`,
  );
}

function effect(
  id: string,
  trackId: string,
  effectName: string,
  parameters: SessionEffect["parameters"] = [],
  enabled = true,
): SessionEffect {
  return { id, trackId, effectName, parameters, enabled };
}

function textParameter(key: string, value: string, numericValue?: number) {
  return { key, value, numericValue };
}

// The whole canvas, as a layer's frame when there is no Order.
const FULL_FRAME = {
  centerX: 0,
  centerY: 0,
  halfWidth: 1,
  halfHeight: 1,
  aspect: 1920 / 1080,
};
const CANVAS = { width: 1920, height: 1080 };

function key(
  keyName: string,
  modifiers: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    code: string;
  }> = {},
) {
  return {
    key: keyName,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  };
}

describe("resolveTextEditorPlacement", () => {
  it("scales an untransformed layer's box onto the letterboxed video", () => {
    const placement = resolveTextEditorPlacement(
      { placement: { frame: FULL_FRAME }, transform: IDENTITY_TRANSFORM },
      { left: 10, top: 20, width: 960, height: 540 },
      CANVAS,
    );

    assert.equal(placement.width, 1920);
    assert.equal(placement.height, 1080);
    assertClose(placement.matrix.a, 0.5);
    assertClose(placement.matrix.b, 0);
    assertClose(placement.matrix.c, 0);
    assertClose(placement.matrix.d, 0.5);
    assertClose(placement.matrix.e, 10);
    assertClose(placement.matrix.f, 20);
  });

  it("follows the layer's Transform, so the editor sits on its box", () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      positionX: 0.25,
      scaleX: 0.5,
      scaleY: 0.5,
      rotationDeg: 90,
    };
    const video = { left: 0, top: 0, width: 960, height: 540 };
    const placement = resolveTextEditorPlacement(
      { placement: { frame: FULL_FRAME }, transform },
      video,
      CANVAS,
    );
    const { a, b, c, d, e, f } = placement.matrix;
    const map = (x: number, y: number) => ({
      x: a * x + c * y + e,
      y: b * x + d * y + f,
    });

    // Resized by half about the center, turned 90° clockwise and moved a
    // quarter of the canvas right: the box's top-left corner lands at the
    // top right of the rotated box.
    assert.equal(placement.width, 960);
    assert.equal(placement.height, 540);
    const topLeft = map(0, 0);
    assertClose(topLeft.x, (960 + 270 + 480) / 2);
    assertClose(topLeft.y, (540 - 480) / 2);
    const bottomRight = map(960, 540);
    assertClose(bottomRight.x, (960 - 270 + 480) / 2);
    assertClose(bottomRight.y, (540 + 480) / 2);
  });

  it("resizes the editor to the scaled text box instead of scaling it", () => {
    const transform = {
      ...IDENTITY_TRANSFORM,
      scaleX: 2,
      scaleY: 0.5,
      originX: -1,
      originY: -1,
    };
    const video = { left: 0, top: 0, width: 960, height: 540 };
    const placement = resolveTextEditorPlacement(
      { placement: { frame: FULL_FRAME }, transform },
      video,
      CANVAS,
    );
    const box = layerBoxInCanvas({ frame: FULL_FRAME }, transform, CANVAS).map(
      ({ x, y }) => ({ x: x / 2, y: y / 2 }),
    );

    // Twice as wide and half as tall, pinned at the top left, with only the
    // monitor's own scale: no CSS stretch.
    assert.equal(placement.width, 3840);
    assert.equal(placement.height, 540);
    assertClose(placement.matrix.a, 0.5);
    assertClose(placement.matrix.b, 0);
    assertClose(placement.matrix.c, 0);
    assertClose(placement.matrix.d, 0.5);
    const { a, b, c, d, e, f } = placement.matrix;
    const corners = [
      [0, 0],
      [3840, 0],
      [3840, 540],
      [0, 540],
    ].map(([x, y]) => ({ x: a * x + c * y + e, y: b * x + d * y + f }));
    // The same box the transform overlay draws and hit-tests.
    corners.forEach((corner, index) => {
      assertClose(corner.x, box[index].x);
      assertClose(corner.y, box[index].y);
    });
  });

  it("formats the matrix for CSS", () => {
    assert.equal(
      formatCssMatrix({ a: 0.5, b: 0, c: 0, d: 0.5, e: 10.1234567, f: 2 }),
      "matrix(0.5, 0, 0, 0.5, 10.123457, 2)",
    );
  });
});

describe("resolveTextEditorTypography", () => {
  // Every character is half the font size wide.
  const measure = (text: string, fontSize: number) =>
    Array.from(text).length * fontSize * 0.5;

  function layout(text: string, resizeToFit: boolean) {
    return layoutText(
      {
        text,
        fontSize: 100,
        minFontSize: 8,
        resizeToFit,
        lineHeight: 1.2,
        letterSpacing: 0.1,
        align: "center",
        verticalAlign: "middle",
        width: 1000,
        height: 500,
        padding: 20,
      },
      measure,
    );
  }

  it("uses the laid-out size, leading and first line", () => {
    const typography = resolveTextEditorTypography(
      { letterSpacing: 0.1, padding: 10, stroke: { color: BLACK, width: 3 } },
      layout("Hi", false),
      2,
    );

    assert.equal(typography.fontSize, 100);
    assertClose(typography.lineHeight, 120);
    assertClose(typography.letterSpacing, 10);
    // One 120 px line centered in the 500 px box.
    assertClose(typography.paddingTop, (500 - 120) / 2);
    assert.equal(typography.paddingX, 20);
    assert.equal(typography.strokeWidth, 12);
  });

  it("shrinks with Resize to fit as the text grows", () => {
    const style = { letterSpacing: 0.1, padding: 20, stroke: undefined };
    const short = resolveTextEditorTypography(style, layout("Short", true), 1);
    const long = resolveTextEditorTypography(
      style,
      layout(
        "A much longer line of text that has to wrap onto several lines",
        true,
      ),
      1,
    );

    assert.equal(short.fontSize, 100);
    assert.ok(long.fontSize < short.fontSize);
    assert.equal(long.strokeWidth, 0);
  });
});

const BLACK = { r: 0, g: 0, b: 0, a: 1 };

describe("textScaleForCanvas", () => {
  it("scales with the short side in landscape and portrait", () => {
    assert.equal(textScaleForCanvas({ width: 1920, height: 1080 }), 1);
    assert.equal(textScaleForCanvas({ width: 1080, height: 1920 }), 1);
    assert.equal(textScaleForCanvas({ width: 1280, height: 720 }), 720 / 1080);
  });
});

describe("resolveTextEditorKey", () => {
  it("commits on Esc and Ctrl/Cmd+Enter, but not plain Enter", () => {
    assert.deepEqual(resolveTextEditorKey(key("Escape")), { kind: "commit" });
    assert.deepEqual(resolveTextEditorKey(key("Enter", { ctrlKey: true })), {
      kind: "commit",
    });
    assert.deepEqual(resolveTextEditorKey(key("Enter", { metaKey: true })), {
      kind: "commit",
    });
    assert.equal(resolveTextEditorKey(key("Enter")), undefined);
    assert.equal(
      resolveTextEditorKey(key("Enter", { shiftKey: true })),
      undefined,
    );
  });

  it("maps the style shortcuts", () => {
    assert.deepEqual(resolveTextEditorKey(key("b", { ctrlKey: true })), {
      kind: "style",
      flag: "Bold",
    });
    assert.deepEqual(resolveTextEditorKey(key("I", { metaKey: true })), {
      kind: "style",
      flag: "Italic",
    });
    assert.deepEqual(resolveTextEditorKey(key("u", { ctrlKey: true })), {
      kind: "style",
      flag: "Underline",
    });
    assert.equal(resolveTextEditorKey(key("b")), undefined);
    assert.equal(
      resolveTextEditorKey(key("b", { ctrlKey: true, altKey: true })),
      undefined,
    );
    // Copy and paste stay with the text field.
    assert.equal(resolveTextEditorKey(key("c", { ctrlKey: true })), undefined);
    assert.equal(resolveTextEditorKey(key("v", { metaKey: true })), undefined);
  });

  it("changes the size with Ctrl/Cmd+Shift+> and <", () => {
    assert.deepEqual(
      resolveTextEditorKey(key(">", { ctrlKey: true, shiftKey: true })),
      { kind: "size", direction: 1 },
    );
    assert.deepEqual(
      resolveTextEditorKey(
        key(".", { metaKey: true, shiftKey: true, code: "Period" }),
      ),
      { kind: "size", direction: 1 },
    );
    assert.deepEqual(
      resolveTextEditorKey(key("<", { ctrlKey: true, shiftKey: true })),
      { kind: "size", direction: -1 },
    );
    assert.equal(resolveTextEditorKey(key(">", { shiftKey: true })), undefined);
  });
});

describe("clip text edits", () => {
  const effects = [
    effect("text-old", "clip:a", "Text", [textParameter("Text", "Old")], false),
    effect("text", "clip:a", "Text", [
      textParameter("Text", "Hello"),
      textParameter("FontStyle", "Italic"),
      textParameter("FontSize", "96", 96),
    ]),
    effect("text-2", "clip:b", "Text", [textParameter("Text", "Other")]),
    // The layer's Text is not the clip's.
    effect("text-layer", "1", "Text", [textParameter("Text", "Layer")]),
  ];

  it("edits the Text effect the compositor draws with", () => {
    assert.equal(findClipTextEffect(effects, "a")?.id, "text");
    assert.equal(readClipText(effects, "a"), "Hello");

    const next = setClipText(effects, "a", "Hello\nworld", "new");
    assert.equal(readClipText(next, "a"), "Hello\nworld");
    assert.equal(readClipText(next, "b"), "Other");
    assert.equal(next.length, effects.length);
  });

  it("keeps an empty text", () => {
    const next = setClipText(effects, "a", "", "new");
    assert.equal(readClipText(next, "a"), "");
  });

  it("adds a Text effect to a clip without one", () => {
    const next = setClipText([], "c", "New", "added");
    assert.equal(next.length, 1);
    assert.equal(next[0].id, "added");
    assert.equal(next[0].trackId, "clip:c");
    assert.equal(readClipText(next, "c"), "New");
  });

  it("turns a bypassed Text effect back on", () => {
    const bypassed = [
      effect("text", "clip:a", "Text", [textParameter("Text", "Hi")], false),
    ];
    const next = setClipText(bypassed, "a", "Hey", "new");
    assert.equal(next[0].enabled, true);
    assert.equal(readClipText(next, "a"), "Hey");
  });

  it("toggles style flags on the whole clip", () => {
    const bold = toggleClipTextStyle(effects, "a", "Bold", "new");
    const style = readTextStyle(findClipTextEffect(bold, "a"));
    assert.equal(style.weight, 700);
    assert.equal(style.italic, true);

    const upright = toggleClipTextStyle(bold, "a", "Italic", "new");
    assert.equal(readTextStyle(findClipTextEffect(upright, "a")).italic, false);
  });

  it("steps the font size within its range", () => {
    const bigger = stepClipFontSize(effects, "a", 1, "new");
    assert.equal(readTextStyle(findClipTextEffect(bigger, "a")).fontSize, 98);

    const tiny = [
      effect("text", "clip:a", "Text", [textParameter("FontSize", "8", 8)]),
    ];
    const smaller = stepClipFontSize(tiny, "a", -1, "new");
    assert.equal(readTextStyle(findClipTextEffect(smaller, "a")).fontSize, 8);
  });
});
