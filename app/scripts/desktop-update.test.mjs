import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUpdateManifest, releaseVersion } from "./desktop-update.mjs";

const BASE_URL = "https://zvid.example/downloads/desktop/";
const ENTRIES = [
  {
    target: "windows-x86_64",
    file: "zvid-windows-setup.exe",
    signature: "d2luZG93cw==\n",
  },
  {
    target: "darwin-aarch64",
    file: "zvid-macos.app.tar.gz",
    signature: "bWFjb3M=",
  },
];

describe("releaseVersion", () => {
  it("uses the run number as the patch so each release run is newer", () => {
    assert.equal(releaseVersion("0.0.0", "41"), "0.0.41");
    assert.equal(releaseVersion("1.2.9", 7), "1.2.7");
  });

  it("rejects a malformed version or run number", () => {
    assert.throws(() => releaseVersion("next", "1"), /semver/);
    assert.throws(() => releaseVersion("0.0.0", ""), /run number/);
    assert.throws(() => releaseVersion("0.0.0", "1.5"), /run number/);
  });
});

describe("buildUpdateManifest", () => {
  it("lists every target's signed update file under the base URL", () => {
    assert.deepEqual(
      buildUpdateManifest({
        version: "0.0.41",
        pubDate: "2026-10-12T00:00:00Z",
        baseUrl: BASE_URL,
        entries: ENTRIES,
      }),
      {
        version: "0.0.41",
        pub_date: "2026-10-12T00:00:00Z",
        platforms: {
          "darwin-aarch64": {
            signature: "bWFjb3M=",
            url: "https://zvid.example/downloads/desktop/zvid-macos.app.tar.gz",
          },
          "windows-x86_64": {
            signature: "d2luZG93cw==",
            url: "https://zvid.example/downloads/desktop/zvid-windows-setup.exe",
          },
        },
      },
    );
  });

  it("fails when a target is missing, unsigned, duplicated or unknown", () => {
    const build = (entries) =>
      buildUpdateManifest({ version: "0.0.1", pubDate: "", baseUrl: BASE_URL, entries });
    assert.throws(() => build(ENTRIES.slice(1)), /missing update targets: windows-x86_64/);
    assert.throws(
      () => build([{ ...ENTRIES[0], signature: " " }, ENTRIES[1]]),
      /windows-x86_64 has no signed update file/,
    );
    assert.throws(() => build([...ENTRIES, ENTRIES[0]]), /duplicate/);
    assert.throws(
      () => build([...ENTRIES, { ...ENTRIES[0], target: "linux-x86_64" }]),
      /unknown update target/,
    );
  });
});
