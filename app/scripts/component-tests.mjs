#!/usr/bin/env node
// Runs the Vitest component tests (`pnpm test:component`), the same way in
// CI and locally. On Linux, Chromium runs headed: headless Linux has no
// pointer device, so turning touch emulation back off (emulateTouch in
// src/component-test/viewport.ts) leaves `(hover: none)` matching for every
// later test file in the page. Without a desktop, the tests run under Xvfb.
// See ARCHITECTURE.md (Testing).
//
// Usage: pnpm test:component [vitest options]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const XVFB_MISSING = `Component tests on Linux need a display: headless Chromium leaves
(hover: none) matching after touch emulation turns off. Install Xvfb
(xvfb-run, e.g. \`sudo apt-get install xvfb\`) or run on a desktop session.`;

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
  const run = componentTestCommand({
    platform: process.platform,
    env: process.env,
    hasXvfbRun: onPath("xvfb-run", process.env),
    args: process.argv.slice(2),
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
