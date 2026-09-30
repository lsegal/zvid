import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LABEL_WIDTH_DEFAULT,
  LABEL_WIDTH_MAX,
  LABEL_WIDTH_MIN,
  PREVIEW_DEFAULT_WIDTH,
  PREVIEW_MAX_WIDTH,
  PREVIEW_MIN_WIDTH,
  PREVIEW_RESERVED_WIDTH,
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

  it("falls back to defaults without a window", () => {
    assert.equal(readLabelWidth(), LABEL_WIDTH_DEFAULT);
    assert.equal(readPreviewWidth(), PREVIEW_DEFAULT_WIDTH);
    assert.equal(readInspectorCollapsed(), false);
  });

  it("leaves the timeline its reserved width", () => {
    assert.equal(getPreviewMaxWidth(0), PREVIEW_MAX_WIDTH);
    assert.equal(getPreviewMaxWidth(100), PREVIEW_MIN_WIDTH);
    assert.equal(getPreviewMaxWidth(PREVIEW_RESERVED_WIDTH + 300), 300);
  });
});
