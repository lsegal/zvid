#!/usr/bin/env node
// Prints the Playwright test list (`playwright test --test-list`) for one CI
// shard of the browser tests. Tests are dealt round-robin across the shards
// in file order, so a file of slow tests spreads over several shards instead
// of landing in one, as Playwright's own --shard does with its contiguous
// slices.
//
// Usage: pnpm exec playwright test --list --reporter=json > all-tests.json
//        node app/scripts/e2e-shard-list.mjs all-tests.json <shard> <total>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Returns each test of a Playwright JSON report as a test-list line,
 * `[project] › file › describe › title`, in report order. */
export function listTests(report) {
  const lines = [];
  const visit = (suite, titles) => {
    const path =
      suite.title && !suite.file?.endsWith(suite.title)
        ? [...titles, suite.title]
        : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        lines.push(
          [`[${test.projectName}]`, spec.file, ...path, spec.title].join(" › "),
        );
      }
    }
    for (const child of suite.suites ?? []) visit(child, path);
  };
  for (const suite of report.suites ?? []) visit(suite, []);
  return lines;
}

/** Returns the lines of shard `shard` (1-based) of `total`. Identical lines
 * (tests sharing a title in one file) select each other, so they count once
 * and run in one shard. */
export function shardTests(lines, shard, total) {
  return [...new Set(lines)].filter((_, index) => index % total === shard - 1);
}

function main() {
  const [reportPath, shardArg, totalArg] = process.argv.slice(2);
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
      "Usage: node app/scripts/e2e-shard-list.mjs <all-tests.json> <shard> <total>",
    );
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const lines = shardTests(listTests(report), shard, total);
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
