#!/usr/bin/env node
// Summarizes one CI shard of the browser tests: prints a Markdown summary of
// the shard's failing and flaky specs (for $GITHUB_STEP_SUMMARY), and fails
// when the shard's test step ran past its time budget, so slow growth is
// visible. Retries don't count against the budget: a flaky test already
// shows in the summary, and its retry would otherwise fail a shard whose
// tests all passed (#1192). Over budget, refresh scripts/e2e-durations.json
// to rebalance the shards, or split the slowest specs.
//
// Usage: node app/scripts/e2e-summary.mjs <e2e-results.json> <shard label>
//          <elapsed seconds> <budget seconds>
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Returns `{ failed, flaky }` lists of `file:line › title` entries from a
 * Playwright JSON report. */
export function collectProblems(report) {
  const failed = [];
  const flaky = [];
  const visit = (suite, titles) => {
    const path =
      suite.title && !suite.file?.endsWith(suite.title)
        ? [...titles, suite.title]
        : titles;
    for (const spec of suite.specs ?? []) {
      const name = `${spec.file}:${spec.line} › ${[...path, spec.title].join(" › ")}`;
      for (const test of spec.tests ?? []) {
        if (test.status === "unexpected") failed.push(name);
        else if (test.status === "flaky") flaky.push(name);
      }
    }
    for (const child of suite.suites ?? []) visit(child, path);
  };
  for (const suite of report.suites ?? []) visit(suite, []);
  return { failed, flaky };
}

/** Returns the seconds a Playwright JSON report's retries took, rounded
 * up. */
export function retrySeconds(report) {
  let milliseconds = 0;
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.retry > 0) milliseconds += result.duration ?? 0;
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report?.suites ?? []) visit(suite);
  return Math.ceil(milliseconds / 1000);
}

/** Returns the Markdown summary and whether the shard exceeded its budget,
 * leaving its retries out of the time counted against it. */
export function summarize(report, shard, elapsed, budget) {
  const retries = retrySeconds(report);
  const counted = Math.max(0, elapsed - retries);
  const overBudget = counted > budget;
  const lines = [`### Browser tests, shard ${shard}`, ""];
  if (!report) {
    lines.push("No test report was written; see the job log.");
  } else {
    const { failed, flaky } = collectProblems(report);
    const stats = report.stats ?? {};
    const retryNote = retries > 0 ? `, ${retries}s of it retries` : "";
    lines.push(
      `${stats.expected ?? 0} passed, ${failed.length} failed, ${flaky.length} flaky, ${stats.skipped ?? 0} skipped in ${elapsed}s${retryNote} (budget ${budget}s).`,
    );
    if (failed.length > 0) {
      lines.push("", "Failed:", "", ...failed.map((name) => `- ${name}`));
    }
    if (flaky.length > 0) {
      lines.push(
        "",
        "Flaky (passed on retry):",
        "",
        ...flaky.map((name) => `- ${name}`),
      );
    }
  }
  if (overBudget) {
    lines.push(
      "",
      `**Over budget:** the test step took ${counted}s without retries, over its ${budget}s budget. Refresh scripts/e2e-durations.json to rebalance the shards, or split the slowest specs.`,
    );
  }
  return { markdown: `${lines.join("\n")}\n`, overBudget, counted };
}

function main() {
  const [reportPath, shard, elapsedArg, budgetArg] = process.argv.slice(2);
  const elapsed = Number(elapsedArg);
  const budget = Number(budgetArg);
  if (
    !reportPath ||
    !shard ||
    !Number.isFinite(elapsed) ||
    !Number.isFinite(budget)
  ) {
    console.error(
      "Usage: node app/scripts/e2e-summary.mjs <e2e-results.json> <shard label> <elapsed seconds> <budget seconds>",
    );
    process.exit(2);
  }
  const report = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, "utf8"))
    : undefined;
  const { markdown, overBudget, counted } = summarize(
    report,
    shard,
    elapsed,
    budget,
  );
  process.stdout.write(markdown);
  if (overBudget) {
    console.error(
      `::error::Browser test shard ${shard} took ${counted}s without retries, over its ${budget}s budget. Refresh scripts/e2e-durations.json to rebalance the shards, or split the slowest specs.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
