// ZVID Capture plugin and zvid desktop app installer downloads. The
// Cloudflare build (scripts/fetch-capture-installers.ts) uploads the
// installers from the latest successful `DAW bundles` run on main to R2, which
// the Worker serves under /downloads (worker/downloads.ts), and describes them
// in a manifest the Help → Install Capture Plugin and Help → Download Desktop
// App dialogs read.

export const CAPTURE_INSTALLERS_DIR = "downloads";
export const CAPTURE_INSTALLERS_MANIFEST = "zvid-capture.json";
export const CAPTURE_INSTALLERS_MANIFEST_URL = `/${CAPTURE_INSTALLERS_DIR}/${CAPTURE_INSTALLERS_MANIFEST}`;

export type CapturePlatform = "macos" | "windows";

export const CAPTURE_PLATFORMS: readonly CapturePlatform[] = [
  "macos",
  "windows",
];

export const CAPTURE_PLATFORM_LABELS: Record<CapturePlatform, string> = {
  macos: "macOS",
  windows: "Windows",
};

export type CaptureInstaller = {
  platform: CapturePlatform;
  // The installer's file name inside /downloads.
  file: string;
  size: number;
};

export type CaptureInstallersManifest = {
  version: string;
  commit: string;
  runUrl: string;
  // The ZVID Capture plugin installers.
  installers: CaptureInstaller[];
  // The zvid desktop app installers, empty when the run built none.
  desktop: CaptureInstaller[];
};

// The `DAW bundles` workflow names artifacts
// `zvid-capture-<version>-<sha>-<platform>`.
const ARTIFACT_PLATFORMS: Record<string, CapturePlatform> = {
  "macos-universal": "macos",
  "windows-x64": "windows",
};

export function artifactPlatform(name: string): CapturePlatform | null {
  const match = /^zvid-capture-.+-(macos-universal|windows-x64)$/.exec(name);
  return match ? ARTIFACT_PLATFORMS[match[1]] : null;
}

// The workflow names desktop app artifacts `zvid-<version>-<sha>-<platform>`.
// The app is built for Apple silicon only on macOS.
const DESKTOP_ARTIFACT_PLATFORMS: Record<string, CapturePlatform> = {
  "macos-arm64": "macos",
  "windows-x64": "windows",
};

export function desktopArtifactPlatform(name: string): CapturePlatform | null {
  const match = /^zvid-(?!capture-).+-(macos-arm64|windows-x64)$/.exec(name);
  return match ? DESKTOP_ARTIFACT_PLATFORMS[match[1]] : null;
}

// The installer inside a bundle zip: the .pkg on macOS, the Inno Setup
// `-setup.exe` on Windows. macOS resource-fork entries are skipped.
export function isCaptureInstallerEntry(
  name: string,
  platform: CapturePlatform,
) {
  if (name.endsWith("/") || name.split("/").includes("__MACOSX")) {
    return false;
  }
  const lower = name.toLowerCase();
  return platform === "macos"
    ? lower.endsWith(".pkg")
    : lower.endsWith("-setup.exe");
}

// The desktop app installer inside its artifact's zip: the .dmg on macOS, the
// NSIS `-setup.exe` on Windows.
export function isDesktopInstallerEntry(
  name: string,
  platform: CapturePlatform,
) {
  if (name.endsWith("/") || name.split("/").includes("__MACOSX")) {
    return false;
  }
  const lower = name.toLowerCase();
  return platform === "macos"
    ? lower.endsWith(".dmg")
    : lower.endsWith("-setup.exe");
}

// The platform a browser runs on, from `navigator.userAgentData.platform`,
// `navigator.platform` or the user agent. iPhones and iPads report Mac-like
// user agents but have touch points, and can't run Live.
export function detectCapturePlatform(nav: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
}): CapturePlatform | null {
  const hint = [nav.userAgentData?.platform, nav.platform, nav.userAgent]
    .filter(Boolean)
    .join(" ");
  if (/android|iphone|ipad|ipod|cros/i.test(hint)) {
    return null;
  }
  if (/\bwin/i.test(hint)) {
    return "windows";
  }
  if (/mac/i.test(hint)) {
    return (nav.maxTouchPoints ?? 0) > 1 ? null : "macos";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseInstallers(value: unknown): CaptureInstaller[] {
  return Array.isArray(value)
    ? value.filter(
        (installer): installer is CaptureInstaller =>
          isRecord(installer) &&
          CAPTURE_PLATFORMS.includes(installer.platform as CapturePlatform) &&
          typeof installer.file === "string" &&
          installer.file !== "" &&
          typeof installer.size === "number",
      )
    : [];
}

// Validates a fetched manifest. Deployments without installers serve the
// SPA's index.html at the manifest URL, which is not JSON at all. Manifests
// written before the desktop app had its own installer have no `desktop`.
export function parseCaptureInstallersManifest(
  value: unknown,
): CaptureInstallersManifest | null {
  if (
    !isRecord(value) ||
    typeof value.version !== "string" ||
    typeof value.commit !== "string" ||
    typeof value.runUrl !== "string" ||
    !Array.isArray(value.installers)
  ) {
    return null;
  }
  const installers = parseInstallers(value.installers);
  const desktop = parseInstallers(value.desktop);
  return installers.length > 0 || desktop.length > 0
    ? {
        version: value.version,
        commit: value.commit,
        runUrl: value.runUrl,
        installers,
        desktop,
      }
    : null;
}

// The installer the download button offers (the detected platform's, if the
// manifest has it) and the other platforms' installers, offered as smaller
// links below it.
export function pickCaptureDownloads(
  installers: readonly CaptureInstaller[],
  platform: CapturePlatform | null,
): { primary: CaptureInstaller | null; alternates: CaptureInstaller[] } {
  const primary =
    installers.find((installer) => installer.platform === platform) ?? null;
  return {
    primary,
    alternates: installers.filter((installer) => installer !== primary),
  };
}

export function captureInstallerUrl(installer: CaptureInstaller) {
  return `/${CAPTURE_INSTALLERS_DIR}/${encodeURIComponent(installer.file)}`;
}

// `8070936` -> `7.7 MB`.
export function formatInstallerSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
