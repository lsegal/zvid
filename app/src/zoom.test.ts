import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampZoom,
  formatZoomFactor,
  stepZoom,
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
