import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LABEL_WIDTH_DEFAULT,
  LABEL_WIDTH_MAX,
  LABEL_WIDTH_MIN,
  PHONE_LABEL_WIDTH,
  PREVIEW_DEFAULT_WIDTH,
  PREVIEW_MIN_WIDTH,
  PREVIEW_RESERVED_WIDTH,
  PREVIEW_TIMELINE_MIN_WIDTH,
} from "./constants.ts";
import {
  clampLabelWidth,
  getPreviewMaxWidth,
  readInspectorCollapsed,
  readLabelWidth,
  readPreviewWidth,
} from "./layout-prefs.ts";

describe("layout prefs", () => {
  it("keeps label widths in range", () => {
    assert.equal(clampLabelWidth(0), LABEL_WIDTH_MIN);
    assert.equal(clampLabelWidth(10_000), LABEL_WIDTH_MAX);
    assert.equal(clampLabelWidth(200.4), 200);
  });

  it("keeps phone label widths in their own range", () => {
    assert.equal(clampLabelWidth(0, PHONE_LABEL_WIDTH), PHONE_LABEL_WIDTH.min);
    assert.equal(
      clampLabelWidth(LABEL_WIDTH_DEFAULT, PHONE_LABEL_WIDTH),
      PHONE_LABEL_WIDTH.max,
    );
    assert.equal(readLabelWidth(PHONE_LABEL_WIDTH), PHONE_LABEL_WIDTH.default);
  });

  it("falls back to defaults without a window", () => {
    assert.equal(readLabelWidth(), LABEL_WIDTH_DEFAULT);
    assert.equal(readPreviewWidth(), PREVIEW_DEFAULT_WIDTH);
    assert.equal(readInspectorCollapsed(), false);
  });

  it("leaves the preview unlimited before the grid is measured", () => {
    assert.equal(getPreviewMaxWidth(0, LABEL_WIDTH_DEFAULT), Infinity);
  });

  it("has no fixed cap on a wide grid", () => {
    assert.equal(
      getPreviewMaxWidth(3000, 200),
      3000 - PREVIEW_RESERVED_WIDTH - 200 - PREVIEW_TIMELINE_MIN_WIDTH,
    );
  });

  it("keeps the timeline area 80px past the current layer headers", () => {
    assert.equal(PREVIEW_TIMELINE_MIN_WIDTH, 80);
    for (const labelWidth of [LABEL_WIDTH_MIN, 240, LABEL_WIDTH_MAX]) {
      const gridWidth = 1400;
      const previewWidth = getPreviewMaxWidth(gridWidth, labelWidth);
      assert.equal(
        gridWidth - PREVIEW_RESERVED_WIDTH - labelWidth - previewWidth,
        PREVIEW_TIMELINE_MIN_WIDTH,
      );
    }
  });

  it("reserves the Media drawer's column", () => {
    assert.equal(
      getPreviewMaxWidth(1400, 240, 336),
      getPreviewMaxWidth(1400, 240) - 336,
    );
  });

  it("falls back to the minimum on a narrow grid", () => {
    assert.equal(
      getPreviewMaxWidth(100, LABEL_WIDTH_DEFAULT),
      PREVIEW_MIN_WIDTH,
    );
    assert.equal(
      getPreviewMaxWidth(
        PREVIEW_RESERVED_WIDTH +
          LABEL_WIDTH_MAX +
          PREVIEW_TIMELINE_MIN_WIDTH +
          PREVIEW_MIN_WIDTH +
          10,
        LABEL_WIDTH_MAX,
        400,
      ),
      PREVIEW_MIN_WIDTH,
    );
  });
});
