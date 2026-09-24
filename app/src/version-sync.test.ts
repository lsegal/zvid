import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// app/package.json is the source of truth for the zvid version.
function readAppFile(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const packageVersion = (
  JSON.parse(readAppFile("package.json")) as { version: string }
).version;

describe("zvid version", () => {
  it("is read by Tauri from package.json", () => {
    const tauriConfig = JSON.parse(
      readAppFile("src-tauri/tauri.conf.json"),
    ) as { version: string };
    assert.equal(tauriConfig.version, "../package.json");
  });

  it("matches the Cargo package version", () => {
    const cargoVersion = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(
      readAppFile("src-tauri/Cargo.toml"),
    )?.[1];
    assert.equal(cargoVersion, packageVersion);
  });
});
