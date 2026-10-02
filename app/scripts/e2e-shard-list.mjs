#!/usr/bin/env node
// Prints the Playwright test list (`playwright test --test-list`) for one CI
// shard of the browser tests. Tests are dealt across the shards by their
// recorded durations (e2e-durations.json), longest first, each to the shard
// with the least time so far, so slow tests spread over the shards and every
// shard takes about as long. A test with no recorded duration counts as the
// average one; with none recorded at all, the tests are dealt round-robin in
// file order.
//
// Usage: pnpm exec playwright test --list --reporter=json > all-tests.json
//        node app/scripts/e2e-shard-list.mjs all-tests.json <shard> <total>
//          [e2e-durations.json]
//
// To record the durations from a run's Playwright JSON report (the merged
// app-playwright-report of a main run includes e2e-durations.json):
//        node app/scripts/e2e-shard-list.mjs --durations e2e-results.json
//          > app/scripts/e2e-durations.json
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Calls `visit(line, test)` for each test of a Playwright JSON report, with
 * its test-list line, `[project] › file › describe › title`, in report
 * order. */
function eachTest(report, visit) {
  const walk = (suite, titles) => {
    const path =
      suite.title && !suite.file?.endsWith(suite.title)
        ? [...titles, suite.title]
        : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        visit(
          [`[${test.projectName}]`, spec.file, ...path, spec.title].join(" › "),
          test,
        );
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
}

/** Returns each test of a Playwright JSON report as a test-list line,
 * `[project] › file › describe › title`, in report order. */
export function listTests(report) {
  const lines = [];
  eachTest(report, (line) => lines.push(line));
  return lines;
}

/** Returns the seconds each test of a Playwright JSON report took on its
 * last passing attempt, by test-list line, sorted by line. A test that never
 * passed ran into its timeout or failed early, so it is left out. Identical
 * lines run in one shard, so their durations add up. */
export function testDurations(report) {
  const durations = {};
  eachTest(report, (line, test) => {
    const result = test.results?.findLast(
      (attempt) => attempt.status === "passed",
    );
    if (result?.duration == null) return;
    durations[line] = (durations[line] ?? 0) + result.duration / 1000;
  });
  return Object.fromEntries(
    Object.keys(durations)
      .sort()
      .map((line) => [line, Math.round(durations[line] * 10) / 10]),
  );
}

/** Returns the lines of shard `shard` (1-based) of `total`, in list order.
 * Identical lines (tests sharing a title in one file) select each other, so
 * they count once and run in one shard. */
export function shardTests(lines, shard, total, durations = {}) {
  const unique = [...new Set(lines)];
  const known = unique.filter((line) => line in durations);
  const average =
    known.reduce((sum, line) => sum + durations[line], 0) / known.length || 1;
  const weight = (line) => durations[line] ?? average;
  const order = unique
    .map((line, index) => ({ line, index }))
    .sort((a, b) => weight(b.line) - weight(a.line) || a.index - b.index);
  const loads = new Array(total).fill(0);
  const assigned = new Map();
  for (const { line } of order) {
    const lightest = loads.indexOf(Math.min(...loads));
    loads[lightest] += weight(line);
    assigned.set(line, lightest);
  }
  return unique.filter((line) => assigned.get(line) === shard - 1);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--durations" && args.length === 2) {
    const report = JSON.parse(readFileSync(args[1], "utf8"));
    process.stdout.write(`${JSON.stringify(testDurations(report), null, 2)}\n`);
    return;
  }
  const [reportPath, shardArg, totalArg, durationsPath] = args;
  const shard = Number(shardArg);
  const total = Number(totalArg);
  if (
    !reportPath ||
    !Number.isInteger(total) ||
    total < 1 ||
    !Number.isInteger(shard) ||
    shard < 1 ||
    shard > total
  ) {
    console.error(
      "Usage: node app/scripts/e2e-shard-list.mjs <all-tests.json> <shard> <total> [e2e-durations.json]\n" +
        "       node app/scripts/e2e-shard-list.mjs --durations <e2e-results.json>",
    );
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const durations = durationsPath
    ? JSON.parse(readFileSync(durationsPath, "utf8"))
    : {};
  const lines = shardTests(listTests(report), shard, total, durations);
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
