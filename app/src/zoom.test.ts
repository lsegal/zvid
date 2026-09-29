import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anchoredTimelineScrollLeft,
  clampZoom,
  formatZoomFactor,
  stepZoom,
  TIMELINE_DRAG_ZOOM_SPEED,
  TIMELINE_DRAG_ZOOM_THRESHOLD_PX,
  timelineDragZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomFillFraction,
} from "./zoom.ts";

describe("formatZoomFactor", () => {
  it("formats the factor as a whole percentage", () => {
    assert.equal(formatZoomFactor(1), "100%");
    assert.equal(formatZoomFactor(0.65), "65%");
    assert.equal(formatZoomFactor(1.8), "180%");
    assert.equal(formatZoomFactor(1.234), "123%");
  });
});

describe("clampZoom", () => {
  it("keeps the zoom within the slider bounds", () => {
    assert.equal(clampZoom(0.1), ZOOM_MIN);
    assert.equal(clampZoom(4), ZOOM_MAX);
    assert.equal(clampZoom(1.2), 1.2);
  });
});

describe("stepZoom", () => {
  it("steps by a tenth from a value on the grid", () => {
    assert.equal(stepZoom(1, 1), 1.1);
    assert.equal(stepZoom(1, -1), 0.9);
    assert.equal(stepZoom(0.7, -1), 0.65);
    assert.equal(stepZoom(0.7, 1), 0.8);
  });

  it("snaps an off-grid value to the next tenth", () => {
    assert.equal(stepZoom(0.73, 1), 0.8);
    assert.equal(stepZoom(0.73, -1), 0.7);
    assert.equal(stepZoom(1.25, 1), 1.3);
    assert.equal(stepZoom(1.25, -1), 1.2);
  });

  it("clamps to the bounds", () => {
    assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN);
    assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX);
    assert.equal(stepZoom(1.75, 1), ZOOM_MAX);
    assert.equal(stepZoom(ZOOM_MIN, 1), 0.7);
    assert.equal(stepZoom(ZOOM_MAX, -1), 1.7);
  });
});

describe("zoomFillFraction", () => {
  it("maps the zoom range onto 0 to 1", () => {
    assert.equal(zoomFillFraction(ZOOM_MIN), 0);
    assert.equal(zoomFillFraction(ZOOM_MAX), 1);
    assert.equal(zoomFillFraction(10), 1);
    assert.ok(Math.abs(zoomFillFraction(1.225) - 0.5) < 1e-9);
  });
});

describe("timelineDragZoom", () => {
  it("keeps the zoom within the threshold", () => {
    assert.equal(timelineDragZoom(1, 0), 1);
    assert.equal(timelineDragZoom(1, TIMELINE_DRAG_ZOOM_THRESHOLD_PX), 1);
    assert.equal(timelineDragZoom(1, -TIMELINE_DRAG_ZOOM_THRESHOLD_PX), 1);
  });

  it("zooms in going up and out going down past the threshold", () => {
    const past = TIMELINE_DRAG_ZOOM_THRESHOLD_PX + 50;
    assert.equal(timelineDragZoom(1, past), 1 + 50 * TIMELINE_DRAG_ZOOM_SPEED);
    assert.equal(timelineDragZoom(1, -past), 1 - 50 * TIMELINE_DRAG_ZOOM_SPEED);
  });

  it("clamps to the zoom range", () => {
    assert.equal(timelineDragZoom(1, 10_000), ZOOM_MAX);
    assert.equal(timelineDragZoom(1, -10_000), ZOOM_MIN);
  });
});

describe("anchoredTimelineScrollLeft", () => {
  const view = { labelWidth: 240, totalQuarters: 400, clientWidth: 1000 };

  it("puts the anchored time under the pointer at any zoom", () => {
    for (const quarterPx of [20, 28, 40]) {
      const left = anchoredTimelineScrollLeft({
        ...view,
        anchorQ: 100,
        pointerX: 600,
        quarterPx,
      });
      assert.equal((left - view.labelWidth + 600) / quarterPx, 100);
    }
  });

  it("clamps to the scrollable range", () => {
    assert.equal(
      anchoredTimelineScrollLeft({
        ...view,
        anchorQ: 0,
        pointerX: 900,
        quarterPx: 28,
      }),
      0,
    );
    assert.equal(
      anchoredTimelineScrollLeft({
        ...view,
        anchorQ: 400,
        pointerX: 0,
        quarterPx: 28,
      }),
      240 + 400 * 28 - 1000,
    );
  });
});
