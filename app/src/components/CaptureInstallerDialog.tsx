import { ArrowDownTrayIcon } from "@heroicons/react/24/solid";
import { useEffect, useState } from "react";
import {
  CAPTURE_INSTALLERS_MANIFEST_URL,
  CAPTURE_PLATFORM_LABELS,
  type CaptureInstaller,
  type CaptureInstallersManifest,
  type CapturePlatform,
  captureInstallerUrl,
  detectCapturePlatform,
  formatInstallerSize,
  parseCaptureInstallersManifest,
  pickCaptureDownloads,
} from "../capture-installers";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type ManifestState =
  | { status: "loading" }
  | { status: "ready"; manifest: CaptureInstallersManifest }
  | { status: "unavailable" };

type CaptureInstallerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

async function loadManifest(): Promise<CaptureInstallersManifest | null> {
  try {
    const response = await fetch(CAPTURE_INSTALLERS_MANIFEST_URL, {
      cache: "no-cache",
    });
    return response.ok
      ? parseCaptureInstallersManifest(await response.json())
      : null;
  } catch {
    return null;
  }
}

// Plug-in folders each installer writes to, and the Live settings that make
// Live scan them.
const INSTALL_NOTES: Record<
  CapturePlatform,
  { installs: string; liveSettings: string }
> = {
  macos: {
    installs:
      "It installs the VST3 and Audio Unit plug-ins into /Library/Audio/Plug-Ins.",
    liveSettings:
      "turn on Use Audio Units and Use VST3 Plug-In System Folders, then click Rescan",
  },
  windows: {
    installs: "It installs the VST3 plug-in into Common Files\\VST3.",
    liveSettings: "turn on Use VST3 Plug-In System Folders, then click Rescan",
  },
};

// The prominent download button for the detected platform.
function DownloadButton({ installer }: { installer: CaptureInstaller }) {
  return (
    <a
      className="capture-installer__download"
      download={installer.file}
      href={captureInstallerUrl(installer)}
    >
      <ArrowDownTrayIcon aria-hidden="true" />
      <span>Download for {CAPTURE_PLATFORM_LABELS[installer.platform]}</span>
      <span className="capture-installer__download-size">
        {formatInstallerSize(installer.size)}
      </span>
    </a>
  );
}

function AlternateLink({ installer }: { installer: CaptureInstaller }) {
  return (
    <a
      className="capture-installer__link"
      download={installer.file}
      href={captureInstallerUrl(installer)}
    >
      {CAPTURE_PLATFORM_LABELS[installer.platform]} (
      {formatInstallerSize(installer.size)})
    </a>
  );
}

export function CaptureInstallerDialog({
  open,
  onOpenChange,
}: CaptureInstallerDialogProps) {
  const [state, setState] = useState<ManifestState>({ status: "loading" });
  const [platform] = useState(() => detectCapturePlatform(navigator));

  const isReady = state.status === "ready";

  // Fetches the manifest each time the dialog opens until it has one.
  useEffect(() => {
    if (!open || isReady) {
      return;
    }
    let isCurrent = true;
    setState({ status: "loading" });
    void loadManifest().then((manifest) => {
      if (isCurrent) {
        setState(
          manifest ? { status: "ready", manifest } : { status: "unavailable" },
        );
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [open, isReady]);

  const { primary, alternates } = pickCaptureDownloads(
    state.status === "ready" ? state.manifest.installers : [],
    platform,
  );
  const notes = platform ? INSTALL_NOTES[platform] : null;
  const platformLabel = platform
    ? CAPTURE_PLATFORM_LABELS[platform]
    : "macOS or Windows";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="capture-installer">
        <DialogHeader>
          <DialogTitle>Install ZVID Capture</DialogTitle>
          <DialogDescription>
            ZVID Capture is a plug-in for Ableton Live 12 or later on{" "}
            {platformLabel}. It previews your camera inside Live and records
            video in sync with your set, ready to edit in zvid.
          </DialogDescription>
        </DialogHeader>

        {platform ? null : (
          <p className="capture-installer__notice" role="note">
            ZVID Capture runs in Ableton Live on macOS and Windows only.
            Download the installer on the computer you run Live on.
          </p>
        )}

        {state.status === "unavailable" ? (
          <p className="capture-installer__notice" role="note">
            Installers aren't included in this build of zvid.
          </p>
        ) : (
          <div className="capture-installer__cta">
            {primary ? (
              <DownloadButton installer={primary} />
            ) : platform ? (
              <button
                className="capture-installer__download"
                disabled
                type="button"
              >
                <ArrowDownTrayIcon aria-hidden="true" />
                <span>
                  {state.status === "loading"
                    ? "Loading…"
                    : `Download for ${platformLabel}`}
                </span>
              </button>
            ) : null}
            {alternates.length > 0 ? (
              <p className="capture-installer__alternates">
                {primary ? "Also available for " : "Download for "}
                {alternates.map((installer, index) => (
                  <span key={installer.platform}>
                    {index > 0 ? " · " : null}
                    <AlternateLink installer={installer} />
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        )}

        <ol className="capture-installer__steps">
          <li>Download and run the installer. {notes?.installs}</li>
          <li>
            In Live, open Settings › Plug-Ins,{" "}
            {notes?.liveSettings ??
              "turn on the plug-in system folders, then click Rescan"}
            .
          </li>
          <li>
            Drag ZVID Capture from Plug-Ins onto an audio track, pick your
            camera in the plug-in window and record.
          </li>
          <li>
            Optional: click Install Live companion in the plug-in window and
            choose ZVID Capture as a Control Surface, so Live's record buttons
            start capture and takes save beside your set.
          </li>
        </ol>

        <DialogFooter>
          {state.status === "ready" ? (
            <span className="capture-installer__version">
              Version {state.manifest.version}
            </span>
          ) : null}
          <DialogClose asChild>
            <button className="ghost-button" type="button">
              Close
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
