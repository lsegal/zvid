// Release helpers for the desktop app's updater, run by the Desktop app
// workflow (.github/workflows/desktop.yml):
//
//   node scripts/desktop-update.mjs version <run-number>
//     prints the release version: package.json's major.minor with the
//     workflow run number as the patch, so every release run is newer than
//     the last and the updater offers it.
//   node scripts/desktop-update.mjs manifest <dir> <base-url> <version>
//     prints the updater manifest (latest.json) built from the per-platform
//     entries (*.json) in <dir>, each naming the platform's update file and
//     its signature, downloadable under <base-url>.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The updater targets the release builds: Apple silicon macOS and x64
// Windows.
export const UPDATE_TARGETS = ["darwin-aarch64", "windows-x86_64"];

export function releaseVersion(packageVersion, runNumber) {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(packageVersion);
  if (!match) throw new Error(`not a semver version: ${packageVersion}`);
  if (!/^\d+$/.test(String(runNumber))) {
    throw new Error(`not a run number: ${runNumber}`);
  }
  return `${match[1]}.${match[2]}.${Number(runNumber)}`;
}

// The manifest Tauri's updater reads, with one entry per update target.
// Fails unless every target has exactly one signed entry.
export function buildUpdateManifest({ version, pubDate, baseUrl, entries }) {
  const platforms = {};
  for (const { target, file, signature } of entries) {
    if (!UPDATE_TARGETS.includes(target)) {
      throw new Error(`unknown update target: ${target}`);
    }
    if (platforms[target]) throw new Error(`duplicate update target: ${target}`);
    if (!file || !signature?.trim()) {
      throw new Error(`${target} has no signed update file`);
    }
    platforms[target] = {
      signature: signature.trim(),
      url: new URL(encodeURIComponent(file), baseUrl).href,
    };
  }
  const missing = UPDATE_TARGETS.filter((target) => !platforms[target]);
  if (missing.length > 0) {
    throw new Error(`missing update targets: ${missing.join(", ")}`);
  }
  return { version, pub_date: pubDate, platforms };
}

function main([command, ...args]) {
  if (command === "version") {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    console.log(releaseVersion(pkg.version, args[0]));
  } else if (command === "manifest") {
    const [dir, baseUrl, version] = args;
    const entries = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
    const manifest = buildUpdateManifest({
      version,
      pubDate: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      baseUrl: baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
      entries,
    });
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
