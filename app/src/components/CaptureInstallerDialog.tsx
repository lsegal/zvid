import { useState } from "react";
import {
  CAPTURE_PLATFORM_LABELS,
  type CapturePlatform,
  detectCapturePlatform,
} from "../capture-installers";
import {
  InstallerDownloadCta,
  useInstallersManifest,
} from "./InstallerDownloads";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type CaptureInstallerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

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

export function CaptureInstallerDialog({
  open,
  onOpenChange,
}: CaptureInstallerDialogProps) {
  const state = useInstallersManifest(open);
  const [platform] = useState(() => detectCapturePlatform(navigator));

  const installers =
    state.status === "ready" ? state.manifest.installers : null;
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

        {state.status === "unavailable" || installers?.length === 0 ? (
          <p className="capture-installer__notice" role="note">
            Installers aren't included in this build of zvid.
          </p>
        ) : (
          <InstallerDownloadCta
            installers={installers}
            platform={platform}
            platformLabel={platformLabel}
          />
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
