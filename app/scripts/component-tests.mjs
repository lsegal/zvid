#!/usr/bin/env node
// Runs the Vitest component tests (`pnpm test:component`), the same way in
// CI and locally. On Linux, Chromium runs headed: headless Linux has no
// pointer device, so turning touch emulation back off (emulateTouch in
// src/component-test/viewport.ts) leaves `(hover: none)` matching for every
// later test file in the page. Without a desktop, the tests run under Xvfb.
// See ARCHITECTURE.md (Testing).
//
// By default it runs only the tests affected by the branch's changes,
// committed or not, since its merge base with main, as CI does for a pull
// request. Test file filters or an explicit --changed/--related pick the
// tests instead, and --all runs the whole suite.
//
// Usage: pnpm test:component [--all] [vitest options] [filters]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const XVFB_MISSING = `Component tests on Linux need a display: headless Chromium leaves
(hover: none) matching after touch emulation turns off. Install Xvfb
(xvfb-run, e.g. \`sudo apt-get install xvfb\`) or run on a desktop session.`;

/** Returns the `vitest run` arguments for the script's `args`, as
 * `{ args }`, or `{ needsBase: true }` when they select by what changed and
 * `since` (the merge base with main) is still unknown. */
export function componentTestArgs({ args, since }) {
  if (args.includes("--all")) {
    return { args: args.filter((arg) => arg !== "--all") };
  }
  if (selectsTests(args)) return { args };
  if (since === undefined) return { needsBase: true };
  return { args: ["--changed", since, "--passWithNoTests", ...args] };
}

/** Whether `args` already pick tests: by what changed, by related source
 * files, or by test file filters. An argument after an option written
 * without `=` is read as that option's value, not a filter. */
function selectsTests(args) {
  return args.some((arg, i) => {
    if (/^--(changed|related)(=|$)/.test(arg)) return true;
    if (arg.startsWith("-")) return false;
    const prev = args[i - 1];
    return !prev?.startsWith("-") || prev.includes("=");
  });
}

/** The commit where HEAD left main, from origin/main or else main. */
function mergeBase() {
  for (const ref of ["origin/main", "main"]) {
    const result = spawnSync("git", ["merge-base", ref, "HEAD"], {
      encoding: "utf8",
    });
    if (result.status === 0) return result.stdout.trim();
  }
  return null;
}

const NO_MERGE_BASE = `Can't find the merge base with main to pick the component tests a change
affects. Fetch main (\`git fetch origin main\`), pass test file filters, or
run the whole suite with \`pnpm test:component --all\`.`;

/** Returns the command that runs `vitest run` with `args`, as
 * `{ command, args }`, or `{ error }` when the platform can't run it. */
export function componentTestCommand({ platform, env, hasXvfbRun, args }) {
  const vitest = ["exec", "vitest", "run", ...args];
  if (platform !== "linux") {
    return { command: "pnpm", args: vitest };
  }
  const headed = [...vitest, "--browser.headless=false"];
  if (hasXvfbRun) {
    return { command: "xvfb-run", args: ["-a", "pnpm", ...headed] };
  }
  if (env.DISPLAY || env.WAYLAND_DISPLAY) {
    return { command: "pnpm", args: headed };
  }
  return { error: XVFB_MISSING };
}

/** Whether `name` is an executable on `PATH`. */
function onPath(name, env) {
  return (env.PATH ?? "")
    .split(path.delimiter)
    .some((dir) => dir && existsSync(path.join(dir, name)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let selection = componentTestArgs({ args });
  if (selection.needsBase) {
    const since = mergeBase();
    if (!since) {
      console.error(NO_MERGE_BASE);
      process.exit(1);
    }
    console.log(
      `Running the component tests affected since ${since.slice(0, 12)} ` +
        "(the merge base with main); pass --all for the whole suite.",
    );
    selection = componentTestArgs({ args, since });
  }
  const run = componentTestCommand({
    platform: process.platform,
    env: process.env,
    hasXvfbRun: onPath("xvfb-run", process.env),
    args: selection.args,
  });
  if (run.error) {
    console.error(run.error);
    process.exit(1);
  }
  const result = spawnSync(run.command, run.args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
