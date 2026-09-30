#!/usr/bin/env node
// Fails when a file under dist is over Cloudflare Workers' 25 MiB static
// asset limit, so `wrangler deploy` stops with a clear message instead of
// Wrangler's own "Asset too large" error midway through the upload.
// wrangler.jsonc's build command (`pnpm run cf:prepare`) runs it last.
//
// Usage: node app/scripts/check-asset-sizes.mjs [dir]
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** Returns `{ path, size }` for each file under `root` over `limit` bytes,
 * with paths relative to `root` using forward slashes. */
export function findOversizedAssets(root, limit = MAX_ASSET_BYTES) {
  const oversized = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        const { size } = statSync(full);
        if (size > limit) {
          oversized.push({
            path: relative(root, full).split(sep).join("/"),
            size,
          });
        }
      }
    }
  };
  visit(root);
  return oversized.sort((a, b) => a.path.localeCompare(b.path));
}

const mib = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export function formatOversizedAssets(oversized, limit = MAX_ASSET_BYTES) {
  return [
    `${oversized.length} file(s) exceed the Cloudflare Workers static asset limit of ${mib(limit)}:`,
    ...oversized.map(({ path, size }) => `  ${path} (${mib(size)})`),
    "Serve large files from R2 instead (see worker/downloads.ts).",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root =
    process.argv[2] ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
  const oversized = findOversizedAssets(root);
  if (oversized.length > 0) {
    console.error(`[asset-sizes] ${formatOversizedAssets(oversized)}`);
    process.exitCode = 1;
  } else {
    console.log(
      `[asset-sizes] every file in ${root} is within ${mib(MAX_ASSET_BYTES)}`,
    );
  }
}
