import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listTests, shardTests } from "./e2e-shard-list.mjs";

const report = {
  suites: [
    {
      title: "a.spec.ts",
      file: "a.spec.ts",
      specs: [
        {
          title: "one",
          file: "a.spec.ts",
          tests: [{ projectName: "chromium" }],
        },
        {
          title: "two",
          file: "a.spec.ts",
          tests: [{ projectName: "chromium" }],
        },
      ],
      suites: [
        {
          title: "group",
          file: "a.spec.ts",
          specs: [
            {
              title: "three",
              file: "a.spec.ts",
              tests: [{ projectName: "chromium" }],
            },
          ],
        },
      ],
    },
    {
      title: "b.spec.ts",
      file: "b.spec.ts",
      specs: [
        {
          title: "four",
          file: "b.spec.ts",
          tests: [{ projectName: "chromium" }],
        },
        {
          title: "four",
          file: "b.spec.ts",
          tests: [{ projectName: "chromium" }],
        },
      ],
    },
  ],
};

describe("listTests", () => {
  it("lists tests as test-list lines with their describe titles", () => {
    assert.deepEqual(listTests(report), [
      "[chromium] › a.spec.ts › one",
      "[chromium] › a.spec.ts › two",
      "[chromium] › a.spec.ts › group › three",
      "[chromium] › b.spec.ts › four",
      "[chromium] › b.spec.ts › four",
    ]);
  });
});

describe("shardTests", () => {
  const lines = listTests(report);

  it("deals the tests round-robin, each test in exactly one shard", () => {
    assert.deepEqual(shardTests(lines, 1, 2), [
      "[chromium] › a.spec.ts › one",
      "[chromium] › a.spec.ts › group › three",
    ]);
    assert.deepEqual(shardTests(lines, 2, 2), [
      "[chromium] › a.spec.ts › two",
      "[chromium] › b.spec.ts › four",
    ]);
  });

  it("leaves shards past the test count empty", () => {
    assert.deepEqual(shardTests(lines, 5, 5), []);
  });
});
