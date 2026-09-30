// ZVID Capture installer downloads. Every merge to main, the `DAW bundles`
// workflow overwrites the installers in the zvid-downloads R2 bucket under
// fixed names and describes them in a manifest the Help → Install Capture
// Plugin dialog reads. The Worker serves the bucket at /downloads
// (worker/downloads.ts).

export const CAPTURE_INSTALLERS_DIR = "downloads/capture";
export const CAPTURE_INSTALLERS_MANIFEST_URL = `/${CAPTURE_INSTALLERS_DIR}/manifest.json`;

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
  // The installer's file name inside /downloads/capture.
  file: string;
  size: number;
  sha256: string;
};

export type CaptureInstallersManifest = {
  // The version stamped into the installers, `<version>+<sha>`.
  version: string;
  // The commit the installers were built from.
  sha: string;
  builtAt: string;
  installers: CaptureInstaller[];
};

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

// Validates a fetched manifest, which is missing (a 404) until the DAW
// bundles workflow first publishes the installers.
export function parseCaptureInstallersManifest(
  value: unknown,
): CaptureInstallersManifest | null {
  if (
    !isRecord(value) ||
    typeof value.version !== "string" ||
    typeof value.sha !== "string" ||
    typeof value.builtAt !== "string" ||
    !Array.isArray(value.installers)
  ) {
    return null;
  }
  const installers = value.installers.filter(
    (installer): installer is CaptureInstaller =>
      isRecord(installer) &&
      CAPTURE_PLATFORMS.includes(installer.platform as CapturePlatform) &&
      typeof installer.file === "string" &&
      installer.file !== "" &&
      typeof installer.size === "number" &&
      typeof installer.sha256 === "string",
  );
  return installers.length > 0
    ? {
        version: value.version,
        sha: value.sha,
        builtAt: value.builtAt,
        installers,
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
