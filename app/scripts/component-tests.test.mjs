import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { componentTestArgs, componentTestCommand } from "./component-tests.mjs";

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

describe("componentTestArgs", () => {
  it("needs the merge base to default to changed-only", () => {
    assert.deepEqual(componentTestArgs({ args: [] }), { needsBase: true });
    assert.deepEqual(componentTestArgs({ args: ["--maxWorkers", "3"] }), {
      needsBase: true,
    });
  });

  it("runs the tests changed since the merge base by default", () => {
    assert.deepEqual(componentTestArgs({ args: [], since: "abc123" }), {
      args: ["--changed", "abc123", "--passWithNoTests"],
    });
    assert.deepEqual(
      componentTestArgs({ args: ["--api.port=63320"], since: "abc123" }),
      {
        args: ["--changed", "abc123", "--passWithNoTests", "--api.port=63320"],
      },
    );
  });

  it("runs the whole suite with --all", () => {
    assert.deepEqual(componentTestArgs({ args: ["--all"] }), { args: [] });
    assert.deepEqual(
      componentTestArgs({ args: ["--maxWorkers=3", "--all"], since: "abc" }),
      { args: ["--maxWorkers=3"] },
    );
  });

  it("keeps an explicit selection as given", () => {
    for (const args of [
      ["--changed", "abc123", "--passWithNoTests"],
      ["--changed=abc123"],
      ["--related", "src/App.tsx"],
      ["src/App.component.test.tsx"],
      ["--maxWorkers=3", "Timeline"],
      ["Timeline", "--maxWorkers", "3"],
    ]) {
      assert.deepEqual(componentTestArgs({ args }), { args });
    }
  });
});
