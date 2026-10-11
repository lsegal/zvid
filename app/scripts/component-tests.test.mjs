import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  componentTestCommand,
  componentTestShards,
  FILES_PER_SHARD,
  MAX_SHARDS,
} from "./component-tests.mjs";

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

describe("componentTestShards", () => {
  it("runs one shard when no test is selected", () => {
    assert.deepEqual(componentTestShards(0), [1]);
  });

  it("keeps a small selection in one shard", () => {
    assert.deepEqual(componentTestShards(FILES_PER_SHARD), [1]);
  });

  it("splits a larger selection into shards of about FILES_PER_SHARD files", () => {
    assert.deepEqual(componentTestShards(FILES_PER_SHARD + 1), [1, 2]);
    assert.deepEqual(componentTestShards(57), [1, 2, 3, 4]);
  });

  it("caps the whole suite at MAX_SHARDS", () => {
    assert.equal(componentTestShards(1000).length, MAX_SHARDS);
  });
});
