import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COLLAPSED_ROW_METRICS,
  clampRowHeight,
  DEFAULT_ROW_METRICS,
  getRowExpandedHeight,
  getRowHeight,
  getRowHeightStyle,
  getRowMetrics,
  getRowSizeClassName,
  isRowCollapsed,
  NO_ROW_HEIGHTS,
  resizeRow,
  setRowHeight,
  toggleRowCollapsed,
} from "./row-heights.ts";

describe("row heights", () => {
  it("gives rows their default height until one is set", () => {
    assert.equal(getRowHeight(NO_ROW_HEIGHTS, "lane", "1"), 66);
    assert.equal(getRowHeight(NO_ROW_HEIGHTS, "source", "1"), 82);
    assert.equal(isRowCollapsed(NO_ROW_HEIGHTS, "lane", "1"), false);
  });

  it("keeps each row's height apart, by kind and id", () => {
    const heights = setRowHeight(NO_ROW_HEIGHTS, "lane", "1", 90);
    assert.equal(getRowHeight(heights, "lane", "1"), 90);
    assert.equal(getRowHeight(heights, "lane", "2"), 66);
    assert.equal(getRowHeight(heights, "source", "1"), 82);
  });

  it("never sets a row shorter than a collapsed one", () => {
    const heights = setRowHeight(NO_ROW_HEIGHTS, "lane", "1", 4);
    assert.equal(getRowHeight(heights, "lane", "1"), 20);
    assert.equal(isRowCollapsed(heights, "lane", "1"), true);
  });

  it("drops the entry of a row set back to its default height", () => {
    const heights = setRowHeight(
      setRowHeight(NO_ROW_HEIGHTS, "source", "1", 40),
      "source",
      "1",
      82,
    );
    assert.equal(heights.size, 0);
  });

  it("collapses a row to 20px and expands it back to its default", () => {
    const collapsed = toggleRowCollapsed(NO_ROW_HEIGHTS, "lane", "1");
    assert.equal(getRowHeight(collapsed, "lane", "1"), 20);
    assert.equal(isRowCollapsed(collapsed, "lane", "1"), true);
    assert.equal(getRowHeight(collapsed, "lane", "2"), 66);

    const expanded = toggleRowCollapsed(collapsed, "lane", "1");
    assert.equal(getRowHeight(expanded, "lane", "1"), 66);
    assert.equal(expanded.size, 0);
  });

  it("expands a collapsed row to the height it had before", () => {
    const tall = setRowHeight(NO_ROW_HEIGHTS, "source", "1", 120);
    const collapsed = toggleRowCollapsed(tall, "source", "1");
    assert.equal(getRowHeight(collapsed, "source", "1"), 20);
    const expanded = toggleRowCollapsed(collapsed, "source", "1");
    assert.equal(getRowHeight(expanded, "source", "1"), 120);
  });

  it("leaves the state it toggles unchanged", () => {
    const heights = setRowHeight(NO_ROW_HEIGHTS, "lane", "1", 90);
    toggleRowCollapsed(heights, "lane", "1");
    assert.equal(getRowHeight(heights, "lane", "1"), 90);
  });
});

describe("resizing rows", () => {
  it("clamps a height between a collapsed row's and 4x the default", () => {
    assert.equal(clampRowHeight(-50, 66), 20);
    assert.equal(clampRowHeight(19.6, 66), 20);
    assert.equal(clampRowHeight(90.4, 66), 90);
    assert.equal(clampRowHeight(264, 66), 264);
    assert.equal(clampRowHeight(1000, 66), 264);
    assert.equal(clampRowHeight(1000, 82), 328);
  });

  it("never sets a row taller than 4x its default", () => {
    const heights = setRowHeight(NO_ROW_HEIGHTS, "source", "1", 900);
    assert.equal(getRowHeight(heights, "source", "1"), 328);
  });

  it("resizes only the dragged row", () => {
    const heights = resizeRow(NO_ROW_HEIGHTS, "lane", "1", 120, 66);
    assert.equal(getRowHeight(heights, "lane", "1"), 120);
    assert.equal(getRowHeight(heights, "lane", "2"), 66);
    assert.equal(getRowHeight(heights, "source", "1"), 82);
  });

  it("clamps the dragged height", () => {
    const tall = resizeRow(NO_ROW_HEIGHTS, "lane", "1", 5000, 66);
    assert.equal(getRowHeight(tall, "lane", "1"), 264);
    const short = resizeRow(NO_ROW_HEIGHTS, "lane", "1", -40, 66);
    assert.equal(getRowHeight(short, "lane", "1"), 20);
  });

  it("collapses a row dragged to the minimum, keeping the height to restore", () => {
    const tall = resizeRow(NO_ROW_HEIGHTS, "source", "1", 140, 82);
    const collapsed = resizeRow(tall, "source", "1", 10, 140);
    assert.equal(isRowCollapsed(collapsed, "source", "1"), true);
    assert.equal(getRowExpandedHeight(collapsed, "source", "1"), 140);

    const expanded = toggleRowCollapsed(collapsed, "source", "1");
    assert.equal(getRowHeight(expanded, "source", "1"), 140);
  });

  it("toggles between collapsed and the dragged height", () => {
    const dragged = resizeRow(NO_ROW_HEIGHTS, "lane", "1", 100, 66);
    assert.equal(getRowExpandedHeight(dragged, "lane", "1"), 100);
    const collapsed = toggleRowCollapsed(dragged, "lane", "1");
    assert.equal(getRowHeight(collapsed, "lane", "1"), 20);
    const expanded = toggleRowCollapsed(collapsed, "lane", "1");
    assert.equal(getRowHeight(expanded, "lane", "1"), 100);
  });

  it("drops the entry of a row dragged back to its default", () => {
    const dragged = resizeRow(NO_ROW_HEIGHTS, "lane", "1", 100, 66);
    assert.equal(resizeRow(dragged, "lane", "1", 66, 100).size, 0);
  });

  it("fits the handle of a row shorter than its default", () => {
    assert.equal(getRowSizeClassName(20, 66), "track-row--collapsed");
    assert.equal(
      getRowSizeClassName(30, 66),
      "track-row--short track-row--one-line",
    );
    assert.equal(getRowSizeClassName(50, 66), "track-row--short");
    assert.equal(getRowSizeClassName(66, 66), "");
    assert.equal(getRowSizeClassName(200, 66), "");
  });
});

describe("row metrics", () => {
  it("sizes default rows' clips as before", () => {
    assert.deepEqual(getRowMetrics("lane", 66), DEFAULT_ROW_METRICS.lane);
    assert.deepEqual(getRowMetrics("source", 82), DEFAULT_ROW_METRICS.source);
  });

  it("gives a collapsed row a 16px clip with a 2px inset", () => {
    for (const kind of ["lane", "source"] as const) {
      assert.deepEqual(getRowMetrics(kind, 20), COLLAPSED_ROW_METRICS);
    }
  });

  it("scales the clip between the collapsed and default sizes", () => {
    const { clipHeight, clipInset } = getRowMetrics("lane", 43);
    assert.ok(clipHeight > 16 && clipHeight < 44);
    assert.ok(clipInset > 2 && clipInset < 11);
    assert.ok(clipHeight + 2 * clipInset <= 43);
  });

  it("styles only rows away from their default height", () => {
    assert.equal(getRowHeightStyle("lane", 66), undefined);
    assert.deepEqual(getRowHeightStyle("lane", 20), {
      "--lane-height": "20px",
      "--lane-clip-height": "16px",
      "--lane-clip-inset": "2px",
    });
    assert.deepEqual(getRowHeightStyle("source", 20), {
      "--lane-height": "20px",
      "--lane-clip-height": "16px",
      "--lane-clip-inset": "2px",
      "--source-row-height": "20px",
      "--source-clip-height": "16px",
      "--source-clip-inset": "2px",
    });
  });
});
