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
    installs:
      "It installs the VST3 plug-in into Common Files\\VST3.",
    liveSettings: "turn on Use VST3 Plug-In System Folders, then click Rescan",
  },
};

function DownloadLink({
  installer,
  className,
}: {
  installer: CaptureInstaller;
  className: string;
}) {
  return (
    <a
      className={className}
      download={installer.file}
      href={captureInstallerUrl(installer)}
    >
      Download for {CAPTURE_PLATFORM_LABELS[installer.platform]} (
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

  const installers =
    state.status === "ready" ? state.manifest.installers : ([] as const);
  const primary = installers.find(
    (installer) => installer.platform === platform,
  );
  const others = installers.filter((installer) => installer !== primary);
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

        <ol className="capture-installer__steps">
          <li>
            Download and run the installer. {notes?.installs}
          </li>
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

        {state.status === "unavailable" ? (
          <p className="capture-installer__notice" role="note">
            Installers aren't included in this build of zvid.
          </p>
        ) : null}

        {state.status === "ready" && others.length > 0 ? (
          <p className="capture-installer__others">
            {primary ? "Also available: " : "Available for: "}
            {others.map((installer, index) => (
              <span key={installer.platform}>
                {index > 0 ? " · " : null}
                <DownloadLink
                  className="capture-installer__link"
                  installer={installer}
                />
              </span>
            ))}
          </p>
        ) : null}

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
          {primary ? (
            <DownloadLink
              className="ghost-button ghost-button--accent"
              installer={primary}
            />
          ) : platform ? (
            <button
              className="ghost-button ghost-button--accent"
              disabled
              type="button"
            >
              {state.status === "loading"
                ? "Loading…"
                : `Download for ${platformLabel}`}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
