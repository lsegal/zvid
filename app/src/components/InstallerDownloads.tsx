import { ArrowDownTrayIcon } from "@heroicons/react/24/solid";
import { useEffect, useState } from "react";
import {
  CAPTURE_PLATFORM_LABELS,
  type CaptureInstaller,
  type CaptureInstallersManifest,
  type CapturePlatform,
  captureInstallerUrl,
  formatInstallerSize,
  parseCaptureInstallersManifest,
  pickCaptureDownloads,
} from "../capture-installers";

// The download buttons the Install Capture Plugin and Download Desktop App
// dialogs share, and the loading of the installers manifest each reads.

export type ManifestState =
  | { status: "loading" }
  | { status: "ready"; manifest: CaptureInstallersManifest }
  | { status: "unavailable" };

async function loadManifest(
  url: string,
): Promise<CaptureInstallersManifest | null> {
  try {
    const response = await fetch(url, {
      cache: "no-cache",
    });
    return response.ok
      ? parseCaptureInstallersManifest(await response.json())
      : null;
  } catch {
    return null;
  }
}

// Fetches the manifest at `url` each time a dialog opens until it has one.
export function useInstallersManifest(
  open: boolean,
  url: string,
): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: "loading" });
  const isReady = state.status === "ready";

  useEffect(() => {
    if (!open || isReady) {
      return;
    }
    let isCurrent = true;
    setState({ status: "loading" });
    void loadManifest(url).then((manifest) => {
      if (isCurrent) {
        setState(
          manifest ? { status: "ready", manifest } : { status: "unavailable" },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [open, isReady, url]);

  return state;
}

// The prominent download button for the detected platform.
function DownloadButton({
  dir,
  installer,
}: {
  dir: string;
  installer: CaptureInstaller;
}) {
  return (
    <a
      className="capture-installer__download"
      download={installer.file}
      href={captureInstallerUrl(installer, dir)}
    >
      <ArrowDownTrayIcon aria-hidden="true" />
      <span>Download for {CAPTURE_PLATFORM_LABELS[installer.platform]}</span>
      <span className="capture-installer__download-size">
        {formatInstallerSize(installer.size)}
      </span>
    </a>
  );
}

function AlternateLink({
  dir,
  installer,
}: {
  dir: string;
  installer: CaptureInstaller;
}) {
  return (
    <a
      className="capture-installer__link"
      download={installer.file}
      href={captureInstallerUrl(installer, dir)}
    >
      {CAPTURE_PLATFORM_LABELS[installer.platform]} (
      {formatInstallerSize(installer.size)})
    </a>
  );
}

// The detected platform's download button, or a disabled one while the
// manifest loads (`installers` is null), and links to the other platforms'
// installers. `dir` is the manifest's directory.
export function InstallerDownloadCta({
  dir,
  installers,
  platform,
  platformLabel,
}: {
  dir: string;
  installers: readonly CaptureInstaller[] | null;
  platform: CapturePlatform | null;
  platformLabel: string;
}) {
  const { primary, alternates } = pickCaptureDownloads(
    installers ?? [],
    platform,
  );
  return (
    <div className="capture-installer__cta">
      {primary ? (
        <DownloadButton dir={dir} installer={primary} />
      ) : platform ? (
        <button className="capture-installer__download" disabled type="button">
          <ArrowDownTrayIcon aria-hidden="true" />
          <span>
            {installers ? `Download for ${platformLabel}` : "Loading…"}
          </span>
        </button>
      ) : null}
      {alternates.length > 0 ? (
        <p className="capture-installer__alternates">
          {primary ? "Also available for " : "Download for "}
          {alternates.map((installer, index) => (
            <span key={installer.platform}>
              {index > 0 ? " · " : null}
              <AlternateLink dir={dir} installer={installer} />
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
