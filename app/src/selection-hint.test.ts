import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  SELECTION_COMPACT_PADDING_PX,
  SELECTION_HINT_FULL,
  SELECTION_HINT_FULL_WIDTH_PX,
  SELECTION_HINT_SHORT,
  SELECTION_HINT_SHORT_WIDTH_PX,
  SELECTION_PADDING_PX,
  selectionHint,
} from "./selection-hint.ts";

const selectionOverlayTsx = readFileSync(
  new URL("./components/timeline/SelectionOverlay.tsx", import.meta.url),
  "utf8",
);
const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const timelineCss = (name: string) =>
  readFileSync(
    new URL(`./components/timeline/${name}.css`, import.meta.url),
    "utf8",
  );
const selectionCss = timelineCss("selection-overlay");
const clipCardCss = timelineCss("clip-card");
const canvasCss = timelineCss("timeline");

// Smallest widths that fit each hint inside its padding and 1px borders.
const fullMin = SELECTION_HINT_FULL_WIDTH_PX + 2 * (SELECTION_PADDING_PX + 1);
const shortMin =
  SELECTION_HINT_SHORT_WIDTH_PX + 2 * (SELECTION_COMPACT_PADDING_PX + 1);

describe("selection hint", () => {
  it("shows the full hint with regular padding on wide selections", () => {
    for (const width of [fullMin, fullMin + 1, 400, 2000]) {
      assert.deepEqual(selectionHint(width), {
        label: SELECTION_HINT_FULL,
        paddingPx: SELECTION_PADDING_PX,
      });
    }
  });

  it("shows the short hint with compact padding on medium selections", () => {
    for (const width of [shortMin, 60, 120, fullMin - 1]) {
      assert.deepEqual(selectionHint(width), {
        label: SELECTION_HINT_SHORT,
        paddingPx: SELECTION_COMPACT_PADDING_PX,
      });
    }
  });

  it("shows no hint below the minimum width", () => {
    for (const width of [0, 1, 12, shortMin - 1]) {
      assert.deepEqual(selectionHint(width), {
        label: null,
        paddingPx: SELECTION_COMPACT_PADDING_PX,
      });
    }
  });

  it("keeps every chosen hint inside the selection box", () => {
    for (let width = 0; width <= 400; width += 1) {
      const { label, paddingPx } = selectionHint(width);
      const textPx =
        label === SELECTION_HINT_FULL
          ? SELECTION_HINT_FULL_WIDTH_PX
          : label === SELECTION_HINT_SHORT
            ? SELECTION_HINT_SHORT_WIDTH_PX
            : 0;
      assert.ok(textPx + 2 * (paddingPx + 1) <= width || label === null);
    }
  });

  it("is wired into the timeline selection render", () => {
    assert.match(selectionOverlayTsx, /selectionHint\(width\)/);
    assert.match(selectionOverlayTsx, /paddingInline: hint\.paddingPx/);
    assert.doesNotMatch(
      selectionOverlayTsx,
      /<span>Press 1-9 to commit<\/span>/,
    );
  });

  it("clips the selection box contents", () => {
    const rule =
      selectionCss.match(/\.timeline-selection \{[^}]*\}/)?.[0] ?? "";
    assert.match(rule, /overflow: hidden;/);
  });
});

describe("timeline selection stacking", () => {
  const cssRule = (css: string, className: string) =>
    css.match(new RegExp(`(^|\\n)\\.${className} \\{[^}]*\\}`))?.[0] ?? "";
  const zToken = (name: string) =>
    Number(appCss.match(new RegExp(`--${name}: (\\d+);`))?.[1]);

  it("paints above the lane's clips, which render after it", () => {
    const rule = cssRule(selectionCss, "timeline-selection");
    assert.match(rule, /z-index: var\(--z-timeline-selection\);/);
    assert.ok(zToken("z-timeline-selection") > 0);
    // Clip cards are their own stacking context at z-index auto, so their
    // handles and filmstrips cannot rise above a positive z-index.
    const clip = cssRule(clipCardCss, "clip-card");
    assert.match(clip, /isolation: isolate;/);
    assert.doesNotMatch(clip, /z-index/);
  });

  it("stays below the playhead", () => {
    assert.match(
      cssRule(canvasCss, "timeline-playhead"),
      /z-index: var\(--z-timeline-playhead\);/,
    );
    assert.ok(zToken("z-timeline-selection") < zToken("z-timeline-playhead"));
  });

  // Presses inside the selection move or resize it (#918), so they no
  // longer pass through to the clips under it.
  it("takes the presses inside it", () => {
    const rule = cssRule(selectionCss, "timeline-selection");
    assert.doesNotMatch(rule, /pointer-events: none;/);
    assert.match(rule, /cursor: grab;/);
    assert.match(
      cssRule(selectionCss, "timeline-selection__handle"),
      /cursor: ew-resize;/,
    );
  });
});
