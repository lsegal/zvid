import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import {
  annotation,
  createCollector,
  errorMessage,
  parseLoadError,
  summarize,
} from "./github-test-reporter.mjs";

const root = resolve("repo");
const file = join(root, "app", "src", "clip.test.ts");

function wrapped(message, failureType = "testCodeFailure") {
  return Object.assign(new Error(message), {
    failureType,
    cause: new Error(message),
  });
}

function collect(events) {
  const collector = createCollector();
  for (const event of events) collector.handle(event);
  return collector;
}

const start = (name, nesting, line) => ({
  type: "test:start",
  data: { name, nesting, line, file },
});
const pass = (name, nesting) => ({
  type: "test:pass",
  data: { name, nesting, file, details: { type: "test" } },
});
const fail = (name, nesting, line, error, type = "test") => ({
  type: "test:fail",
  data: { name, nesting, line, file, details: { type, error } },
});

describe("createCollector", () => {
  it("names failing tests by their suites", () => {
    const { failures, tests } = collect([
      start("Clip", 0, 3),
      start("trim", 1, 4),
      start("keeps the end", 2, 5),
      fail("keeps the end", 2, 5, wrapped("1 !== 2")),
      start("passes", 2, 9),
      pass("passes", 2),
      fail("trim", 1, 4, wrapped("1 subtest failed", "subtestsFailed"), "suite"),
      fail("Clip", 0, 3, wrapped("1 subtest failed", "subtestsFailed"), "suite"),
      start("top level", 0, 12),
      fail("top level", 0, 12, wrapped("boom")),
    ]);
    assert.equal(tests, 3);
    assert.deepEqual(failures, [
      { name: "Clip › trim › keeps the end", file, line: 5, message: "1 !== 2" },
      { name: "top level", file, line: 12, message: "boom" },
    ]);
  });

  it("skips tests canceled by their suite", () => {
    const { failures } = collect([
      start("Clip", 0, 3),
      start("waits", 1, 4),
      fail("waits", 1, 4, wrapped("canceled", "cancelledByParent")),
      fail("Clip", 0, 3, wrapped("before hook failed", "hookFailed"), "suite"),
    ]);
    assert.deepEqual(
      failures.map((failure) => failure.name),
      ["Clip"],
    );
  });

  it("reports the error of a file that fails to load", () => {
    const stderr = [
      "file:///repo/app/src/clip.test.ts:2\n",
      'import { nope } from "./clip.ts";\n',
      "         ^^^^\n",
      "SyntaxError: The requested module './clip.ts' does not provide an export named 'nope'\n",
      "    at ModuleJob._instantiate (node:internal/modules/esm/module_job:180:21)\n",
    ];
    const { failures } = collect([
      ...stderr.map((message) => ({
        type: "test:stderr",
        data: { file, message },
      })),
      start("clip.test.ts", 0, 1),
      fail("clip.test.ts", 0, 1, wrapped("test failed")),
    ]);
    assert.deepEqual(failures, [
      {
        name: "clip.test.ts",
        file,
        line: 2,
        message:
          "SyntaxError: The requested module './clip.ts' does not provide an export named 'nope'",
      },
    ]);
  });
});

describe("errorMessage", () => {
  it("prefers the error the test threw", () => {
    assert.equal(errorMessage(wrapped("boom")), "boom");
    assert.equal(errorMessage({ message: "wrapper", cause: "text" }), "text");
    assert.equal(errorMessage({ message: "wrapper" }), "wrapper");
  });
});

describe("parseLoadError", () => {
  it("returns undefined when stderr has no error", () => {
    assert.equal(parseLoadError(["a warning", ""]), undefined);
  });

  it("reads an error with a code and no location", () => {
    assert.deepEqual(
      parseLoadError(["TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file"]),
      {
        message: "TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file",
        line: undefined,
      },
    );
  });
});

describe("annotation", () => {
  it("annotates the failing line with an escaped message", () => {
    assert.equal(
      annotation(
        {
          name: "Clip › a, b: c",
          file,
          line: 5,
          message: "50% off\nnext line\n",
        },
        root,
      ),
      "::error file=app/src/clip.test.ts,line=5,title=Clip › a%2C b%3A c::Clip › a, b: c: 50%25 off%0Anext line",
    );
  });
});

describe("summarize", () => {
  it("lists the failures in a table", () => {
    assert.equal(
      summarize(
        [{ name: "a | b", file, line: 5, message: "1 !== 2\n\nmore" }],
        4,
        "App unit tests",
        root,
      ),
      [
        "### App unit tests",
        "",
        "1 of 4 tests failed.",
        "",
        "| Test | Location | Error |",
        "| --- | --- | --- |",
        "| a \\| b | `app/src/clip.test.ts:5` | 1 !== 2 more |",
        "",
      ].join("\n"),
    );
  });

  it("reports a passing run", () => {
    assert.equal(
      summarize([], 3, "Unit tests", root),
      "### Unit tests\n\nAll 3 tests passed.\n",
    );
  });
});
