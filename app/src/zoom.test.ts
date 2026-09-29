import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anchoredTimelineScrollLeft,
  clampZoom,
  formatZoomFactor,
  sliderPositionToZoom,
  stepZoom,
  TIMELINE_DRAG_ZOOM_SPEED,
  TIMELINE_DRAG_ZOOM_THRESHOLD_PX,
  timelineDragZoom,
  ZOOM_LADDER,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomFillFraction,
  zoomToSliderPosition,
} from "./zoom.ts";

function assertClose(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be close to ${expected}`,
  );
}

describe("formatZoomFactor", () => {
  it("formats the factor as a whole percentage", () => {
    assert.equal(formatZoomFactor(1), "100%");
    assert.equal(formatZoomFactor(0.25), "25%");
    assert.equal(formatZoomFactor(3), "300%");
    assert.equal(formatZoomFactor(1.234), "123%");
  });
});

describe("clampZoom", () => {
  it("keeps the zoom within 25% to 300%", () => {
    assert.equal(ZOOM_MIN, 0.25);
    assert.equal(ZOOM_MAX, 3);
    assert.equal(clampZoom(0.1), 0.25);
    assert.equal(clampZoom(4), 3);
    assert.equal(clampZoom(0.65), 0.65);
    assert.equal(clampZoom(1.8), 1.8);
  });
});

describe("stepZoom", () => {
  it("walks the ladder up and down", () => {
    const up = [ZOOM_MIN];
    while (up[up.length - 1] < ZOOM_MAX) {
      up.push(stepZoom(up[up.length - 1], 1));
    }
    assert.deepEqual(up, [...ZOOM_LADDER]);

    const down = [ZOOM_MAX];
    while (down[down.length - 1] > ZOOM_MIN) {
      down.push(stepZoom(down[down.length - 1], -1));
    }
    assert.deepEqual(down, [...ZOOM_LADDER].reverse());
  });

  it("snaps an off-ladder zoom to the next rung", () => {
    assert.equal(stepZoom(0.73, 1), 0.8);
    assert.equal(stepZoom(0.73, -1), 0.67);
    assert.equal(stepZoom(1.8, 1), 2);
    assert.equal(stepZoom(1.8, -1), 1.5);
    assert.equal(stepZoom(0.6700000001, -1), 0.5);
  });

  it("grows by a similar factor at every step", () => {
    for (let index = 1; index < ZOOM_LADDER.length; index += 1) {
      const factor = ZOOM_LADDER[index] / ZOOM_LADDER[index - 1];
      assert.ok(factor >= 1.19 && factor <= 1.52, `${factor}`);
    }
  });

  it("clamps to the bounds", () => {
    assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN);
    assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX);
    assert.equal(stepZoom(0.2, -1), ZOOM_MIN);
    assert.equal(stepZoom(5, 1), ZOOM_MAX);
  });
});

describe("slider mapping", () => {
  it("puts the ends of the range at the ends of the track", () => {
    assert.equal(zoomToSliderPosition(ZOOM_MIN), 0);
    assert.equal(zoomToSliderPosition(ZOOM_MAX), 1);
    assert.equal(zoomToSliderPosition(0.1), 0);
    assert.equal(zoomToSliderPosition(10), 1);
    assert.equal(sliderPositionToZoom(0), ZOOM_MIN);
    assert.equal(sliderPositionToZoom(1), ZOOM_MAX);
    assert.equal(sliderPositionToZoom(-1), ZOOM_MIN);
    assert.equal(sliderPositionToZoom(2), ZOOM_MAX);
  });

  it("moves along log(zoom)", () => {
    // Equal zoom factors take equal travel.
    assertClose(
      zoomToSliderPosition(0.5) - zoomToSliderPosition(0.25),
      zoomToSliderPosition(2) - zoomToSliderPosition(1),
    );
    assertClose(
      zoomToSliderPosition(Math.sqrt(ZOOM_MIN * ZOOM_MAX)),
      0.5,
    );
  });

  it("maps both ways", () => {
    for (const zoom of [...ZOOM_LADDER, 0.42, 1.8, 2.73]) {
      assert.equal(sliderPositionToZoom(zoomToSliderPosition(zoom)), zoom);
    }
  });

  it("fills the track to the thumb", () => {
    for (const zoom of [ZOOM_MIN, 0.5, 1, 2, ZOOM_MAX]) {
      assert.equal(zoomFillFraction(zoom), zoomToSliderPosition(zoom));
    }
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
    assertClose(
      timelineDragZoom(1, past),
      Math.exp(50 * TIMELINE_DRAG_ZOOM_SPEED),
    );
    assertClose(
      timelineDragZoom(1, -past),
      Math.exp(-50 * TIMELINE_DRAG_ZOOM_SPEED),
    );
  });

  it("scales by the same factor at any zoom", () => {
    const past = TIMELINE_DRAG_ZOOM_THRESHOLD_PX + 80;
    const factor = timelineDragZoom(1, past);
    for (const origin of [0.5, 1, 2]) {
      assertClose(timelineDragZoom(origin, past) / origin, factor);
      assertClose(origin / timelineDragZoom(origin, -past), factor);
    }
  });

  it("is undone by dragging back the same distance", () => {
    const past = TIMELINE_DRAG_ZOOM_THRESHOLD_PX + 60;
    const zoomedIn = timelineDragZoom(0.8, past);
    assertClose(timelineDragZoom(zoomedIn, -past), 0.8);
  });

  it("reaches both ends of the range", () => {
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
