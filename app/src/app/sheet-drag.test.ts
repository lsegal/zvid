import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fxSheetAfterDrag,
  menuSheetClosesAfterDrag,
  SHEET_DRAG_THRESHOLD,
} from "./sheet-drag.ts";

// An 800px-tall phone viewport: half height is 416px, so full to half is
// 384px of travel.
const VIEWPORT = 800;

describe("fxSheetAfterDrag", () => {
  it("keeps the height for a drag shorter than the threshold", () => {
    assert.equal(fxSheetAfterDrag("half", SHEET_DRAG_THRESHOLD - 1, VIEWPORT), "half");
    assert.equal(fxSheetAfterDrag("half", 1 - SHEET_DRAG_THRESHOLD, VIEWPORT), "half");
    assert.equal(fxSheetAfterDrag("full", 20, VIEWPORT), "full");
  });

  it("goes to full height when dragged up", () => {
    assert.equal(fxSheetAfterDrag("half", -80, VIEWPORT), "full");
    assert.equal(fxSheetAfterDrag("full", -80, VIEWPORT), "full");
  });

  it("closes when dragged down from half height", () => {
    assert.equal(fxSheetAfterDrag("half", 80, VIEWPORT), null);
  });

  it("stops at half height when dragged down from full", () => {
    assert.equal(fxSheetAfterDrag("full", 80, VIEWPORT), "half");
    assert.equal(fxSheetAfterDrag("full", 384, VIEWPORT), "half");
  });

  it("closes when dragged from full well past half height", () => {
    assert.equal(fxSheetAfterDrag("full", 384 + SHEET_DRAG_THRESHOLD, VIEWPORT), null);
  });
});

describe("menuSheetClosesAfterDrag", () => {
  it("closes only once the drag reaches the threshold", () => {
    assert.equal(menuSheetClosesAfterDrag(SHEET_DRAG_THRESHOLD - 1), false);
    assert.equal(menuSheetClosesAfterDrag(SHEET_DRAG_THRESHOLD), true);
    assert.equal(menuSheetClosesAfterDrag(-200), false);
  });
});
