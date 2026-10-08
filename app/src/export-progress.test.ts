import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeExportActivity,
  estimateExportSecondsLeft,
  formatSecondsLeft,
  formatSnapshotTime,
} from "./export-progress.ts";

const rendering = (progress: number | null) => ({
  phase: "rendering" as const,
  progress,
  detail: "",
});

describe("estimateExportSecondsLeft", () => {
  it("extrapolates the rest of the render from the time so far", () => {
    // 25% in 10 s leaves 30 s.
    assert.equal(estimateExportSecondsLeft(rendering(25), 1_000, 11_000), 30);
  });

  it("has no estimate before rendering progress", () => {
    assert.equal(estimateExportSecondsLeft(null, 0, 1_000), undefined);
    assert.equal(estimateExportSecondsLeft(rendering(0), 0, 1_000), undefined);
    assert.equal(
      estimateExportSecondsLeft(rendering(null), 0, 1_000),
      undefined,
    );
    assert.equal(
      estimateExportSecondsLeft(rendering(50), null, 1_000),
      undefined,
    );
    assert.equal(
      estimateExportSecondsLeft(
        { phase: "muxing", progress: null, detail: "" },
        0,
        1_000,
      ),
      undefined,
    );
  });
});

describe("formatSecondsLeft", () => {
  it("formats minutes and seconds, rounding up", () => {
    assert.equal(formatSecondsLeft(0), "0:00");
    assert.equal(formatSecondsLeft(0.2), "0:01");
    assert.equal(formatSecondsLeft(72), "1:12");
    assert.equal(formatSecondsLeft(3723), "1:02:03");
    assert.equal(formatSecondsLeft(-5), "0:00");
  });
});

describe("describeExportActivity", () => {
  it("shows the percentage and the time left", () => {
    assert.equal(
      describeExportActivity(rendering(42), 72),
      "Exporting 42% · 1:12 left",
    );
    assert.equal(
      describeExportActivity(rendering(42), undefined),
      "Exporting 42%",
    );
  });

  it("names the phases without a percentage", () => {
    assert.equal(describeExportActivity(null, undefined), "Exporting…");
    assert.equal(
      describeExportActivity(
        { phase: "muxing", progress: null, detail: "" },
        undefined,
      ),
      "Exporting · writing MP4",
    );
    assert.equal(
      describeExportActivity(
        { phase: "muxing", progress: null, detail: "", container: "webm" },
        undefined,
      ),
      "Exporting · writing WebM",
    );
  });
});

describe("formatSnapshotTime", () => {
  it("formats the wall-clock hour and minute", () => {
    assert.equal(formatSnapshotTime(new Date(2026, 0, 1, 9, 4)), "09:04");
    assert.equal(formatSnapshotTime(new Date(2026, 0, 1, 12, 34)), "12:34");
  });
});
