#!/usr/bin/env node
// Fails when an app/src source file grows past its line budget, so no new
// App.tsx-sized module can form unnoticed. Files already over the default
// budget are listed in file-size-allowlist.json at their size when recorded:
// they may shrink but never grow, and the list ratchets down as they do.
//
// Usage: node app/scripts/check-file-size.mjs [--write]
//   --write  lowers allowlist entries to the files' current sizes and drops
//            entries for files now within the default budget or deleted.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_LIMIT = 800;

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = join(appDir, "scripts", "file-size-allowlist.json");

const SOURCE_EXTENSIONS = /\.(ts|tsx|css)$/;
// Tests, type declarations and generated files are not hand-maintained
// modules; fixtures directories hold sample data.
const EXCLUDED_FILES = /(\.test\.[^.]+|\.d\.ts|\.generated\.[^.]+)$/;
const EXCLUDED_DIRS = new Set(["fixtures", "__fixtures__", "node_modules"]);
const GENERATED_MARKER = /@generated\b/;

export function countLines(text) {
  if (text === "") return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function isGenerated(text) {
  return GENERATED_MARKER.test(text.split("\n", 5).join("\n"));
}

/** Returns `{ path, lines }` for each checked file under `root`, with paths
 * relative to `base` using forward slashes. */
export function collectSourceFiles(root, base = root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        files.push(...collectSourceFiles(path, base));
      }
      continue;
    }
    if (!SOURCE_EXTENSIONS.test(entry.name)) continue;
    if (EXCLUDED_FILES.test(entry.name)) continue;
    const text = readFileSync(path, "utf8");
    if (isGenerated(text)) continue;
    files.push({
      path: relative(base, path).split(sep).join("/"),
      lines: countLines(text),
    });
  }
  return files;
}

/**
 * Checks files against the default limit and the allowlist.
 * - `errors`: files over their limit (they fail the check).
 * - `hints`: allowlist entries that can be lowered or removed.
 * - `allowlist`: the ratcheted-down allowlist `--write` would save.
 */
export function checkFileSizes(files, allowlist, limit = DEFAULT_LIMIT) {
  const errors = [];
  const hints = [];
  const next = {};
  const seen = new Set();
  for (const { path, lines } of [...files].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    seen.add(path);
    const recorded = allowlist[path];
    if (recorded === undefined) {
      if (lines > limit) {
        errors.push({ path, lines, limit });
      }
      continue;
    }
    if (lines > recorded) {
      errors.push({ path, lines, limit: recorded, allowlisted: true });
      next[path] = recorded;
    } else if (lines <= limit) {
      hints.push({ path, lines, recorded, remove: true });
    } else {
      if (lines < recorded) hints.push({ path, lines, recorded });
      next[path] = lines;
    }
  }
  for (const path of Object.keys(allowlist).sort()) {
    if (!seen.has(path)) hints.push({ path, recorded: allowlist[path] });
  }
  return { errors, hints, allowlist: next };
}

function main() {
  const write = process.argv.includes("--write");
  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
  const files = collectSourceFiles(join(appDir, "src"), appDir);
  const result = checkFileSizes(files, allowlist);
  const allowlistName = "app/scripts/file-size-allowlist.json";

  for (const { path, lines, limit, allowlisted } of result.errors) {
    console.error(
      `app/${path}: ${lines} lines exceeds ${allowlisted ? "its allowlisted size" : "the limit"} of ${limit}`,
    );
  }
  for (const { path, lines, recorded, remove } of result.hints) {
    if (lines === undefined) {
      console.log(
        `app/${path} no longer exists; remove it from ${allowlistName}`,
      );
    } else if (remove) {
      console.log(
        `app/${path} is now ${lines} lines, within the ${DEFAULT_LIMIT}-line limit; remove it from ${allowlistName}`,
      );
    } else {
      console.log(
        `app/${path} shrank to ${lines} lines; lower its entry in ${allowlistName} from ${recorded} to ${lines}`,
      );
    }
  }

  if (write && result.hints.length > 0) {
    writeFileSync(
      allowlistPath,
      `${JSON.stringify(result.allowlist, null, 2)}\n`,
    );
    console.log(`Updated ${allowlistName}.`);
  } else if (result.hints.length > 0) {
    console.log(
      "Run `node app/scripts/check-file-size.mjs --write` to update the allowlist.",
    );
  }

  if (result.errors.length > 0) {
    console.error(
      `\n${result.errors.length} file(s) over their line budget. Split them into smaller modules (see "Where code goes" in app/README.md) rather than raising the limit.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
