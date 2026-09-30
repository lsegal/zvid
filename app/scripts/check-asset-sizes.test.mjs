import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  findOversizedAssets,
  formatOversizedAssets,
  MAX_ASSET_BYTES,
} from "./check-asset-sizes.mjs";

const script = fileURLToPath(
  new URL("./check-asset-sizes.mjs", import.meta.url),
);

function withDist(files, run) {
  const root = mkdtempSync(join(tmpdir(), "asset-sizes-"));
  try {
    for (const [path, size] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), Buffer.alloc(size));
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("findOversizedAssets", () => {
  it("finds nested files over the limit", () => {
    withDist(
      { "index.html": 10, "downloads/big.pkg": 11, "assets/at-limit.js": 10 },
      (root) => {
        assert.deepEqual(findOversizedAssets(root, 10), [
          { path: "downloads/big.pkg", size: 11 },
        ]);
      },
    );
  });

  it("uses Cloudflare's 25 MiB limit by default", () => {
    assert.equal(MAX_ASSET_BYTES, 25 * 1024 * 1024);
  });
});

describe("formatOversizedAssets", () => {
  it("names each file and its size", () => {
    const message = formatOversizedAssets(
      [{ path: "downloads/zvid-capture.pkg", size: 50_122_547 }],
      MAX_ASSET_BYTES,
    );
    assert.match(message, /limit of 25\.0 MiB/);
    assert.match(message, /downloads\/zvid-capture\.pkg \(47\.8 MiB\)/);
  });
});

describe("check-asset-sizes CLI", () => {
  it("fails with a clear message when a file is too large", () => {
    withDist({ "downloads/big.pkg": MAX_ASSET_BYTES + 1 }, (root) => {
      const result = spawnSync(process.execPath, [script, root], {
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /downloads\/big\.pkg \(25\.0 MiB\)/);
    });
  });

  it("passes when every file is within the limit", () => {
    withDist({ "index.html": 100 }, (root) => {
      const result = spawnSync(process.execPath, [script, root], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0);
    });
  });
});
