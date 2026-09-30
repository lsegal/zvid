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

type DesktopAppDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// How each platform's installer installs the app.
const INSTALL_STEPS: Record<CapturePlatform, string> = {
  macos: "Open the downloaded .dmg and drag zvid into Applications.",
  windows:
    "Run the installer. It also installs the Microsoft Edge WebView2 Runtime if Windows doesn't have it yet.",
};

// Help → Download Desktop App: the zvid desktop app installers, separate from
// the ZVID Capture plug-in's.
export function DesktopAppDialog({ open, onOpenChange }: DesktopAppDialogProps) {
  const state = useInstallersManifest(open);
  const [platform] = useState(() => detectCapturePlatform(navigator));

  const installers = state.status === "ready" ? state.manifest.desktop : null;
  const platformLabel = platform
    ? CAPTURE_PLATFORM_LABELS[platform]
    : "macOS or Windows";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="capture-installer">
        <DialogHeader>
          <DialogTitle>Download the zvid desktop app</DialogTitle>
          <DialogDescription>
            The zvid desktop app runs zvid as an app on {platformLabel}. On
            macOS it needs a Mac with Apple silicon. The ZVID Capture plug-in
            has its own installer under Help › Install Capture Plugin.
          </DialogDescription>
        </DialogHeader>

        {platform ? null : (
          <p className="capture-installer__notice" role="note">
            The desktop app runs on macOS and Windows only.
          </p>
        )}

        {state.status === "unavailable" || installers?.length === 0 ? (
          <p className="capture-installer__notice" role="note">
            The desktop app isn't included in this build of zvid.
          </p>
        ) : (
          <InstallerDownloadCta
            installers={installers}
            platform={platform}
            platformLabel={platformLabel}
          />
        )}

        {platform ? (
          <ol className="capture-installer__steps">
            <li>{INSTALL_STEPS[platform]}</li>
          </ol>
        ) : null}

        <DialogFooter>
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
