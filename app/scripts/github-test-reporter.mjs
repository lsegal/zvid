// A node:test reporter for CI: prints one GitHub Actions `::error`
// annotation per failing test, including test files that fail to load, and
// appends a Markdown table of the failures to $GITHUB_STEP_SUMMARY. Failures
// then show on the run summary and inline on the pull request diff. CI pairs
// it with the spec reporter, whose log ends with a recap of the failures;
// local runs use neither.
//
// Usage (the CI unit test steps set this):
//   NODE_OPTIONS="--test-reporter=spec --test-reporter-destination=stdout
//     --test-reporter=<path to this file> --test-reporter-destination=stdout"
// TEST_SUMMARY_TITLE names the suite in the job summary.
import { appendFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

// Failures that only repeat a child's: a suite whose subtests failed, and
// tests canceled because their suite failed.
const DERIVED_FAILURES = new Set(["subtestsFailed", "cancelledByParent"]);

// The message node:test gives a test file whose process exited with an
// error before reporting any tests, such as a module that fails to load.
const FILE_FAILED_MESSAGE = "test failed";

const ERROR_LINE = /^\s*([A-Za-z]*Error)\b.*?:\s/;
const STDERR_LOCATION = /^file:\/\/\S+?:(\d+)\s*$/;

/** Collects failing tests from node:test reporter events. */
export function createCollector() {
  const names = new Map(); // file -> names of the open suites by nesting
  const stderr = new Map(); // file -> stderr lines
  const failures = [];
  let tests = 0;

  const linesFor = (file) => {
    const key = resolve(file);
    if (!stderr.has(key)) stderr.set(key, []);
    return stderr.get(key);
  };

  return {
    handle({ type, data }) {
      if (type === "test:stderr" && data.file) {
        linesFor(data.file).push(...String(data.message).split("\n"));
      } else if (type === "test:start" && data.file) {
        const path = names.get(data.file) ?? [];
        path.length = data.nesting;
        path.push(data.name);
        names.set(data.file, path);
      } else if (type === "test:pass" || type === "test:fail") {
        if (data.details?.type !== "suite") tests += 1;
        if (type === "test:pass") return;
        const error = data.details?.error;
        if (DERIVED_FAILURES.has(error?.failureType)) return;
        const path = (names.get(data.file) ?? []).slice(0, data.nesting);
        let message = errorMessage(error);
        let line = data.line;
        if (message === FILE_FAILED_MESSAGE && data.file) {
          const loadError = parseLoadError(linesFor(data.file));
          if (loadError) {
            message = loadError.message;
            line = loadError.line ?? line;
          }
        }
        failures.push({
          name: [...path, data.name].join(" › "),
          file: data.file,
          line,
          message,
        });
      }
    },
    get failures() {
      return failures;
    },
    get tests() {
      return tests;
    },
  };
}

/** Returns the message of a failing test's error, preferring the error the
 * test threw over node:test's wrapper. */
export function errorMessage(error) {
  if (!error) return "failed";
  const cause = error.cause;
  if (cause && typeof cause === "object" && typeof cause.message === "string") {
    return cause.message;
  }
  if (typeof cause === "string") return cause;
  return error.message ?? String(error);
}

/** Finds the error a test file printed when it failed to load, with the line
 * Node pointed at, or undefined when its stderr holds no error. */
export function parseLoadError(lines) {
  const index = lines.findIndex((line) => ERROR_LINE.test(line));
  if (index < 0) return undefined;
  let line;
  for (let i = index - 1; i >= 0; i -= 1) {
    const match = STDERR_LOCATION.exec(lines[i]);
    if (match) {
      line = Number(match[1]);
      break;
    }
  }
  return { message: lines[index].trim(), line };
}

/** Returns `file` relative to `root` with forward slashes. */
export function repoPath(file, root) {
  return relative(root, resolve(file)).split(sep).join("/");
}

function escapeData(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text) {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/** Returns the workflow command that annotates one failure. */
export function annotation(failure, root) {
  const properties = [];
  if (failure.file) {
    properties.push(`file=${escapeProperty(repoPath(failure.file, root))}`);
    if (failure.line) properties.push(`line=${failure.line}`);
  }
  properties.push(`title=${escapeProperty(failure.name)}`);
  const message = `${failure.name}: ${failure.message.trim()}`;
  return `::error ${properties.join(",")}::${escapeData(message)}`;
}

function tableCell(text) {
  const flat = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  const short = flat.length > 300 ? `${flat.slice(0, 299)}…` : flat;
  return short.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** Returns the job summary Markdown for a run's failures. */
export function summarize(failures, tests, title, root) {
  const lines = [`### ${title}`, ""];
  if (failures.length === 0) {
    lines.push(`All ${tests} tests passed.`);
  } else {
    lines.push(
      `${failures.length} of ${tests} tests failed.`,
      "",
      "| Test | Location | Error |",
      "| --- | --- | --- |",
    );
    for (const failure of failures) {
      const location = failure.file
        ? `${repoPath(failure.file, root)}${failure.line ? `:${failure.line}` : ""}`
        : "";
      lines.push(
        `| ${tableCell(failure.name)} | ${location ? `\`${location}\`` : ""} | ${tableCell(failure.message)} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export default async function* githubReporter(source) {
  const collector = createCollector();
  for await (const event of source) collector.handle(event);
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  for (const failure of collector.failures) {
    yield `${annotation(failure, root)}\n`;
  }
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const title = process.env.TEST_SUMMARY_TITLE ?? "Unit tests";
    appendFileSync(
      summaryPath,
      summarize(collector.failures, collector.tests, title, root),
    );
  }
}
