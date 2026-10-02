import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listTests, shardTests, testDurations } from "./e2e-shard-list.mjs";

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

  it("deals the tests round-robin with no recorded durations", () => {
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

describe("shardTests with recorded durations", () => {
  const lines = [
    "[chromium] › a.spec.ts › one",
    "[chromium] › a.spec.ts › two",
    "[chromium] › a.spec.ts › three",
    "[chromium] › b.spec.ts › four",
    "[chromium] › b.spec.ts › five",
  ];

  it("deals the longest tests first, each to the least loaded shard", () => {
    const durations = {
      "[chromium] › a.spec.ts › one": 2,
      "[chromium] › a.spec.ts › two": 20,
      "[chromium] › a.spec.ts › three": 8,
      "[chromium] › b.spec.ts › four": 9,
      "[chromium] › b.spec.ts › five": 3,
    };
    // two (20) | four (9), three (8), five (3) | then one (2) ties to shard 1.
    assert.deepEqual(shardTests(lines, 1, 2, durations), [
      "[chromium] › a.spec.ts › one",
      "[chromium] › a.spec.ts › two",
    ]);
    assert.deepEqual(shardTests(lines, 2, 2, durations), [
      "[chromium] › a.spec.ts › three",
      "[chromium] › b.spec.ts › four",
      "[chromium] › b.spec.ts › five",
    ]);
  });

  it("counts a test with no recorded duration as the average one", () => {
    const durations = {
      "[chromium] › a.spec.ts › one": 10,
      "[chromium] › a.spec.ts › two": 2,
      "[chromium] › a.spec.ts › three": 2,
      "[chromium] › b.spec.ts › four": 2,
    };
    // "five" weighs 4: after "one" fills shard 1, it goes to shard 2 first.
    assert.deepEqual(shardTests(lines, 1, 2, durations), [
      "[chromium] › a.spec.ts › one",
    ]);
    assert.deepEqual(shardTests(lines, 2, 2, durations), [
      "[chromium] › a.spec.ts › two",
      "[chromium] › a.spec.ts › three",
      "[chromium] › b.spec.ts › four",
      "[chromium] › b.spec.ts › five",
    ]);
  });

  it("puts every test in exactly one shard", () => {
    const durations = { "[chromium] › b.spec.ts › four": 30 };
    const shards = [1, 2, 3].map((shard) =>
      shardTests(lines, shard, 3, durations),
    );
    assert.deepEqual(shards.flat().sort(), [...lines].sort());
  });
});

describe("testDurations", () => {
  it("records each test's last passing attempt in seconds, by test-list line", () => {
    const passed = (duration) => ({ status: "passed", duration });
    const timed = structuredClone(report);
    const [a, b] = timed.suites;
    a.specs[0].tests[0].results = [passed(1234)];
    a.specs[1].tests[0].results = [
      { status: "failed", duration: 9000 },
      passed(4560),
    ];
    a.suites[0].specs[0].tests[0].results = [
      { status: "timedOut", duration: 90000 },
    ];
    b.specs[0].tests[0].results = [passed(1000)];
    b.specs[1].tests[0].results = [passed(2000)];
    assert.deepEqual(testDurations(timed), {
      "[chromium] › a.spec.ts › one": 1.2,
      "[chromium] › a.spec.ts › two": 4.6,
      "[chromium] › b.spec.ts › four": 3,
    });
  });
});
