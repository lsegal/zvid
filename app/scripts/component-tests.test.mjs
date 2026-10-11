import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { componentTestCommand } from "./component-tests.mjs";

const args = ["--changed", "abc123"];

describe("componentTestCommand", () => {
  it("runs vitest headless off Linux", () => {
    assert.deepEqual(
      componentTestCommand({
        platform: "darwin",
        env: {},
        hasXvfbRun: false,
        args,
      }),
      { command: "pnpm", args: ["exec", "vitest", "run", ...args] },
    );
  });

  it("runs headed under Xvfb on Linux when xvfb-run is installed", () => {
    assert.deepEqual(
      componentTestCommand({
        platform: "linux",
        env: { DISPLAY: ":0" },
        hasXvfbRun: true,
        args,
      }),
      {
        command: "xvfb-run",
        args: [
          "-a",
          "pnpm",
          "exec",
          "vitest",
          "run",
          ...args,
          "--browser.headless=false",
        ],
      },
    );
  });

  it("runs headed on the Linux desktop without xvfb-run", () => {
    for (const env of [{ DISPLAY: ":0" }, { WAYLAND_DISPLAY: "wayland-0" }]) {
      assert.deepEqual(
        componentTestCommand({
          platform: "linux",
          env,
          hasXvfbRun: false,
          args,
        }),
        {
          command: "pnpm",
          args: ["exec", "vitest", "run", ...args, "--browser.headless=false"],
        },
      );
    }
  });

  it("fails with a pointer to Xvfb on Linux with no display", () => {
    const run = componentTestCommand({
      platform: "linux",
      env: {},
      hasXvfbRun: false,
      args,
    });
    assert.equal(run.command, undefined);
    assert.match(run.error, /xvfb-run/);
    assert.match(run.error, /\(hover: none\)/);
  });
});
