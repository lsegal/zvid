import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectProblems, summarize } from "./e2e-summary.mjs";

const report = {
  stats: { expected: 2, unexpected: 1, flaky: 1, skipped: 0 },
  suites: [
    {
      title: "clip.spec.ts",
      file: "clip.spec.ts",
      specs: [
        {
          title: "drags a clip",
          file: "clip.spec.ts",
          line: 4,
          tests: [{ status: "unexpected" }],
        },
        {
          title: "selects a clip",
          file: "clip.spec.ts",
          line: 9,
          tests: [{ status: "expected" }],
        },
      ],
      suites: [
        {
          title: "trim",
          file: "clip.spec.ts",
          specs: [
            {
              title: "trims the start",
              file: "clip.spec.ts",
              line: 20,
              tests: [{ status: "flaky" }],
            },
            {
              title: "trims the end",
              file: "clip.spec.ts",
              line: 30,
              tests: [{ status: "expected" }],
            },
          ],
        },
      ],
    },
  ],
};

describe("collectProblems", () => {
  it("lists failing and flaky specs with their describe titles", () => {
    assert.deepEqual(collectProblems(report), {
      failed: ["clip.spec.ts:4 › drags a clip"],
      flaky: ["clip.spec.ts:20 › trim › trims the start"],
    });
  });
});

describe("summarize", () => {
  it("lists the problems and passes within budget", () => {
    const { markdown, overBudget } = summarize(report, "3/16", 42, 90);
    assert.equal(overBudget, false);
    assert.match(markdown, /### Browser tests, shard 3\/16/);
    assert.match(markdown, /2 passed, 1 failed, 1 flaky, 0 skipped in 42s/);
    assert.match(markdown, /- clip\.spec\.ts:4 › drags a clip/);
    assert.match(markdown, /- clip\.spec\.ts:20 › trim › trims the start/);
    assert.doesNotMatch(markdown, /Over budget/);
  });

  it("passes a 96s shard within a 150s budget", () => {
    const { markdown, overBudget } = summarize(report, "8/16", 96, 150);
    assert.equal(overBudget, false);
    assert.match(markdown, /in 96s \(budget 150s\)/);
    assert.doesNotMatch(markdown, /Over budget/);
  });

  it("flags a shard over its budget", () => {
    const { markdown, overBudget } = summarize(report, "3/16", 151, 150);
    assert.equal(overBudget, true);
    assert.match(markdown, /Over budget:\*\* the test step took 151s/);
    assert.match(markdown, /Refresh scripts\/e2e-durations\.json/);
  });

  it("notes a missing report", () => {
    const { markdown } = summarize(undefined, "1/16", 5, 90);
    assert.match(markdown, /No test report was written/);
  });
});
