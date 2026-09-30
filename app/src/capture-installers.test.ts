import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAPTURE_INSTALLERS_MANIFEST_URL,
  CAPTURE_PLATFORM_LABELS,
  captureInstallerUrl,
  detectCapturePlatform,
  formatInstallerSize,
  parseCaptureInstallersManifest,
  pickCaptureDownloads,
} from "./capture-installers.ts";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LINUX_FIREFOX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

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
    sha: "bba098408a1e717bcd68cb5a4cda2a82b66417dc",
    builtAt: "2026-09-30T08:00:00Z",
    installers: [
      {
        platform: "macos",
        file: "zvid-capture-macos.pkg",
        size: 8070936,
        sha256:
          "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      },
      {
        platform: "windows",
        file: "zvid-capture-windows-setup.exe",
        size: 3556059,
        sha256:
          "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752",
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
        { platform: "linux", file: "zvid.deb", size: 1, sha256: "" },
        { platform: "macos", file: "", size: 1, sha256: "" },
        { platform: "windows", file: "zvid-setup.exe", size: 1 },
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
    // The manifest the old Cloudflare build packaged with the app.
    assert.equal(
      parseCaptureInstallersManifest({
        version: manifest.version,
        commit: manifest.sha,
        runUrl: "https://github.com/lsegal/zvid/actions/runs/1",
        installers: manifest.installers,
      }),
      null,
    );
  });
});

describe("pickCaptureDownloads", () => {
  const mac = {
    platform: "macos",
    file: "zvid.pkg",
    size: 1,
    sha256: "",
  } as const;
  const windows = {
    platform: "windows",
    file: "zvid-setup.exe",
    size: 1,
    sha256: "",
  } as const;

  it("offers the detected platform's installer and links the other", () => {
    assert.deepEqual(pickCaptureDownloads([mac, windows], "windows"), {
      primary: windows,
      alternates: [mac],
    });
    assert.deepEqual(pickCaptureDownloads([mac, windows], "macos"), {
      primary: mac,
      alternates: [windows],
    });
  });

  it("only links installers when the platform has none", () => {
    assert.deepEqual(pickCaptureDownloads([mac, windows], null), {
      primary: null,
      alternates: [mac, windows],
    });
    assert.deepEqual(pickCaptureDownloads([mac], "windows"), {
      primary: null,
      alternates: [mac],
    });
  });
});

describe("captureInstallerUrl", () => {
  it("serves installers from /downloads/capture with an encoded name", () => {
    assert.equal(
      CAPTURE_INSTALLERS_MANIFEST_URL,
      "/downloads/capture/manifest.json",
    );
    assert.equal(
      captureInstallerUrl({
        platform: "macos",
        file: "zvid-capture-macos.pkg",
        size: 1,
        sha256: "",
      }),
      "/downloads/capture/zvid-capture-macos.pkg",
    );
    assert.equal(
      captureInstallerUrl({
        platform: "windows",
        file: "a b.exe",
        size: 1,
        sha256: "",
      }),
      "/downloads/capture/a%20b.exe",
    );
  });
});

describe("formatInstallerSize", () => {
  it("formats bytes as megabytes", () => {
    assert.equal(formatInstallerSize(8070936), "7.7 MB");
    assert.equal(formatInstallerSize(3556059), "3.4 MB");
  });
});

describe("CAPTURE_PLATFORM_LABELS", () => {
  it("labels the macOS download as Apple silicon only", () => {
    assert.equal(CAPTURE_PLATFORM_LABELS.macos, "macOS (Apple Silicon)");
    assert.equal(CAPTURE_PLATFORM_LABELS.windows, "Windows");
  });
});
