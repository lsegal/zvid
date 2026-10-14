import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("./build-midi-sample.mjs", import.meta.url),
);

describe("build-midi-sample", () => {
  it("matches the committed sample session and manifest", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--check"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  });
});
