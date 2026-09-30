import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  checkFileSizes,
  collectSourceFiles,
  countLines,
} from "./check-file-size.mjs";

describe("countLines", () => {
  it("counts lines with and without a trailing newline", () => {
    assert.equal(countLines(""), 0);
    assert.equal(countLines("a"), 1);
    assert.equal(countLines("a\nb\n"), 2);
    assert.equal(countLines("a\r\nb"), 2);
  });
});

describe("checkFileSizes", () => {
  it("fails a file over the default limit that is not allowlisted", () => {
    const result = checkFileSizes(
      [
        { path: "src/big.ts", lines: 11 },
        { path: "src/ok.ts", lines: 10 },
      ],
      {},
      10,
    );
    assert.deepEqual(result.errors, [
      { path: "src/big.ts", lines: 11, limit: 10 },
    ]);
    assert.deepEqual(result.hints, []);
  });

  it("fails an allowlisted file that grew past its recorded size", () => {
    const result = checkFileSizes(
      [{ path: "src/App.tsx", lines: 21 }],
      { "src/App.tsx": 20 },
      10,
    );
    assert.deepEqual(result.errors, [
      { path: "src/App.tsx", lines: 21, limit: 20, allowlisted: true },
    ]);
    assert.deepEqual(result.allowlist, { "src/App.tsx": 20 });
  });

  it("passes an allowlisted file at its recorded size", () => {
    const result = checkFileSizes(
      [{ path: "src/App.tsx", lines: 20 }],
      { "src/App.tsx": 20 },
      10,
    );
    assert.deepEqual(result, {
      errors: [],
      hints: [],
      allowlist: { "src/App.tsx": 20 },
    });
  });

  it("hints to lower the entry of an allowlisted file that shrank", () => {
    const result = checkFileSizes(
      [{ path: "src/App.tsx", lines: 15 }],
      { "src/App.tsx": 20 },
      10,
    );
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.hints, [
      { path: "src/App.tsx", lines: 15, recorded: 20 },
    ]);
    assert.deepEqual(result.allowlist, { "src/App.tsx": 15 });
  });

  it("hints to remove entries within the default limit or for deleted files", () => {
    const result = checkFileSizes(
      [{ path: "src/App.tsx", lines: 10 }],
      { "src/App.tsx": 20, "src/gone.ts": 30 },
      10,
    );
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.hints, [
      { path: "src/App.tsx", lines: 10, recorded: 20, remove: true },
      { path: "src/gone.ts", recorded: 30 },
    ]);
    assert.deepEqual(result.allowlist, {});
  });
});

describe("collectSourceFiles", () => {
  it("skips tests, declarations, fixtures, generated files and other extensions", () => {
    const root = mkdtempSync(join(tmpdir(), "check-file-size-"));
    try {
      mkdirSync(join(root, "src", "components"), { recursive: true });
      mkdirSync(join(root, "src", "fixtures"));
      writeFileSync(join(root, "src", "a.ts"), "1\n2\n");
      writeFileSync(join(root, "src", "components", "B.tsx"), "1\n");
      writeFileSync(join(root, "src", "c.css"), "1\n2\n3\n");
      writeFileSync(join(root, "src", "a.test.ts"), "1\n");
      writeFileSync(join(root, "src", "env.d.ts"), "1\n");
      writeFileSync(join(root, "src", "index.generated.ts"), "1\n");
      writeFileSync(join(root, "src", "gen.ts"), "// @generated\n1\n");
      writeFileSync(join(root, "src", "fixtures", "f.ts"), "1\n");
      writeFileSync(join(root, "src", "logo.svg"), "<svg/>\n");

      const files = collectSourceFiles(join(root, "src"), root).sort((a, b) =>
        a.path.localeCompare(b.path),
      );
      assert.deepEqual(files, [
        { path: "src/a.ts", lines: 2 },
        { path: "src/c.css", lines: 3 },
        { path: "src/components/B.tsx", lines: 1 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
