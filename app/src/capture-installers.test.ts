import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  artifactPlatform,
  captureInstallerUrl,
  detectCapturePlatform,
  formatInstallerSize,
  isCaptureInstallerEntry,
  parseCaptureInstallersManifest,
} from "./capture-installers.ts";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LINUX_FIREFOX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("artifactPlatform", () => {
  it("maps DAW bundle artifact names to platforms", () => {
    assert.equal(
      artifactPlatform("zvid-capture-0.1.0-bba0984-macos-universal"),
      "macos",
    );
    assert.equal(
      artifactPlatform("zvid-capture-0.1.0-bba0984-windows-x64"),
      "windows",
    );
  });

  it("ignores other artifacts", () => {
    assert.equal(artifactPlatform("host-test-windows-x64"), null);
    assert.equal(artifactPlatform("zvid-capture-0.1.0-bba0984-linux"), null);
  });
});

describe("isCaptureInstallerEntry", () => {
  it("picks the macOS .pkg from a bundle zip", () => {
    const dir = "zvid-capture-0.1.0-bba0984-macos-universal";
    assert.ok(
      isCaptureInstallerEntry(`${dir}/zvid-capture-0.1.0+bba0984.pkg`, "macos"),
    );
    assert.ok(!isCaptureInstallerEntry(`${dir}/ZVID Capture.vst3/`, "macos"));
    assert.ok(
      !isCaptureInstallerEntry(
        `__MACOSX/${dir}/._zvid-capture-0.1.0+bba0984.pkg`,
        "macos",
      ),
    );
  });

  it("picks the Windows setup executable from a bundle zip", () => {
    assert.ok(
      isCaptureInstallerEntry(
        "zvid-capture-0.1.0+bba0984-setup.exe",
        "windows",
      ),
    );
    assert.ok(
      !isCaptureInstallerEntry(
        "ZVID Capture.vst3/Contents/x86_64-win/ZVID Capture.vst3",
        "windows",
      ),
    );
    assert.ok(
      !isCaptureInstallerEntry("zvid-capture-0.1.0+bba0984.pkg", "windows"),
    );
  });
});

describe("detectCapturePlatform", () => {
  it("detects macOS and Windows desktops", () => {
    assert.equal(
      detectCapturePlatform({ userAgent: MAC_SAFARI, platform: "MacIntel" }),
      "macos",
    );
    assert.equal(
      detectCapturePlatform({ userAgent: WINDOWS_CHROME, platform: "Win32" }),
      "windows",
    );
  });

  it("prefers userAgentData's platform", () => {
    assert.equal(
      detectCapturePlatform({
        userAgent: WINDOWS_CHROME,
        userAgentData: { platform: "Windows" },
      }),
      "windows",
    );
    assert.equal(
      detectCapturePlatform({ userAgentData: { platform: "macOS" } }),
      "macos",
    );
  });

  it("returns null where Live doesn't run", () => {
    assert.equal(
      detectCapturePlatform({ userAgent: LINUX_FIREFOX, platform: "Linux" }),
      null,
    );
    assert.equal(
      detectCapturePlatform({ userAgent: IPHONE, platform: "iPhone" }),
      null,
    );
    // iPadOS Safari reports a Mac user agent but has touch points.
    assert.equal(
      detectCapturePlatform({
        userAgent: MAC_SAFARI,
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
      null,
    );
    assert.equal(detectCapturePlatform({}), null);
  });
});

describe("parseCaptureInstallersManifest", () => {
  const manifest = {
    version: "0.1.0+bba0984",
    commit: "bba098408a1e717bcd68cb5a4cda2a82b66417dc",
    runUrl: "https://github.com/lsegal/zvid/actions/runs/36356285598",
    installers: [
      {
        platform: "macos",
        file: "zvid-capture-0.1.0+bba0984.pkg",
        size: 8070936,
      },
      {
        platform: "windows",
        file: "zvid-capture-0.1.0+bba0984-setup.exe",
        size: 3556059,
      },
    ],
  };

  it("accepts the manifest the build writes", () => {
    assert.deepEqual(parseCaptureInstallersManifest(manifest), manifest);
  });

  it("drops malformed installers", () => {
    const parsed = parseCaptureInstallersManifest({
      ...manifest,
      installers: [
        ...manifest.installers,
        { platform: "linux", file: "zvid.deb", size: 1 },
        { platform: "macos", file: "", size: 1 },
      ],
    });
    assert.deepEqual(parsed?.installers, manifest.installers);
  });

  it("rejects manifests without installers", () => {
    assert.equal(parseCaptureInstallersManifest(null), null);
    assert.equal(parseCaptureInstallersManifest("<!doctype html>"), null);
    assert.equal(
      parseCaptureInstallersManifest({ ...manifest, installers: [] }),
      null,
    );
    assert.equal(
      parseCaptureInstallersManifest({ ...manifest, version: 1 }),
      null,
    );
  });
});

describe("captureInstallerUrl", () => {
  it("serves installers from /downloads with an encoded name", () => {
    assert.equal(
      captureInstallerUrl({
        platform: "macos",
        file: "zvid-capture-0.1.0-bba0984.pkg",
        size: 1,
      }),
      "/downloads/zvid-capture-0.1.0-bba0984.pkg",
    );
    assert.equal(
      captureInstallerUrl({ platform: "windows", file: "a b.exe", size: 1 }),
      "/downloads/a%20b.exe",
    );
  });
});

describe("formatInstallerSize", () => {
  it("formats bytes as megabytes", () => {
    assert.equal(formatInstallerSize(8070936), "7.7 MB");
    assert.equal(formatInstallerSize(3556059), "3.4 MB");
  });
});
