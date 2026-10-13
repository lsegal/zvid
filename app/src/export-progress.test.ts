import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createExportTimeEstimator,
  describeExportActivity,
  describeExportTimeLeft,
  formatSecondsLeft,
  formatSnapshotTime,
} from "./export-progress.ts";

const rendering = (progress: number | null) => ({
  phase: "rendering" as const,
  progress,
  detail: "",
});

describe("createExportTimeEstimator", () => {
  it("extrapolates the rest of the render from the time so far", () => {
    const estimate = createExportTimeEstimator();
    assert.equal(estimate(rendering(0), 1_000), undefined);
    // 25% in 10 s leaves 30 s.
    assert.equal(estimate(rendering(25), 11_000), 30);
  });

  it("has no estimate before rendering progress", () => {
    assert.equal(createExportTimeEstimator()(null, 1_000), undefined);
    assert.equal(
      createExportTimeEstimator()(rendering(null), 1_000),
      undefined,
    );
    const estimate = createExportTimeEstimator();
    assert.equal(estimate(rendering(0), 0), undefined);
    assert.equal(estimate(rendering(0), 2_000), undefined);
    // The first frames are too few to extrapolate from.
    const early = createExportTimeEstimator();
    assert.equal(early(rendering(0), 1_000), undefined);
    assert.equal(early(rendering(1), 1_050), undefined);
    assert.equal(
      early({ phase: "muxing", progress: null, detail: "" }, 3_000),
      undefined,
    );
  });

  it("follows the recent render rate", () => {
    const estimate = createExportTimeEstimator();
    estimate(rendering(0), 0);
    // 1% a second for 20 s, then 4% a second: 60% left takes 15 s.
    for (let second = 1; second <= 20; second++) {
      estimate(rendering(second), second * 1_000);
    }
    let left: number | undefined;
    for (let second = 1; second <= 5; second++) {
      left = estimate(rendering(20 + second * 4), (20 + second) * 1_000);
    }
    assert.equal(left, 15);
  });

  it("never counts up when the render slows down", () => {
    const estimate = createExportTimeEstimator();
    estimate(rendering(0), 0);
    // 2% a second for 20 s, then 0.5% a second.
    const shown: number[] = [];
    for (let second = 1; second <= 20; second++) {
      shown.push(estimate(rendering(second * 2), second * 1_000) ?? NaN);
    }
    for (let second = 1; second <= 100; second++) {
      const percent = 40 + Math.floor(second / 2);
      shown.push(estimate(rendering(percent), (20 + second) * 1_000) ?? NaN);
    }
    for (let i = 1; i < shown.length; i++) {
      assert.ok(shown[i] <= shown[i - 1], `${shown[i]} > ${shown[i - 1]}`);
    }
    // It holds at 30 s left until the slower rate catches up, then follows
    // it: 10% left at 0.5% a second.
    assert.equal(shown[20 + 30], 30);
    assert.equal(shown.at(-1), 20);
    assert.equal(estimate(rendering(100), 140_000), 0);
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

describe("describeExportTimeLeft", () => {
  it("shows the time left once the render can be extrapolated", () => {
    assert.equal(describeExportTimeLeft(rendering(25), 72), "1:12 left");
  });

  it("says it is estimating until there is render progress", () => {
    assert.equal(
      describeExportTimeLeft(null, undefined),
      "Estimating time left…",
    );
    assert.equal(
      describeExportTimeLeft(
        { phase: "preparing", progress: null, detail: "" },
        undefined,
      ),
      "Estimating time left…",
    );
    assert.equal(
      describeExportTimeLeft(rendering(0), undefined),
      "Estimating time left…",
    );
  });

  it("says it is finishing up while writing the file", () => {
    assert.equal(
      describeExportTimeLeft(
        { phase: "muxing", progress: null, detail: "" },
        undefined,
      ),
      "Finishing up…",
    );
  });
});
