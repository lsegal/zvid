// The desktop app's updater: checks the update manifest the Desktop app
// workflow publishes beside the installers (/downloads/desktop/latest.json),
// asks before installing, then installs and relaunches. Tauri's updater
// verifies each download against the public key in tauri.conf.json and
// refuses to install one whose signature doesn't match. The web app has no
// updater.

// The subset of the updater plugin's `Update` this module uses.
export type DesktopUpdate = {
  version: string;
  downloadAndInstall(): Promise<void>;
};

export type DesktopUpdaterDeps = {
  check(): Promise<DesktopUpdate | null>;
  ask(message: string): Promise<boolean>;
  relaunch(): Promise<void>;
};

export type DesktopUpdateResult =
  | "up-to-date"
  | "declined"
  | "installed"
  | "failed";

async function loadDesktopUpdaterDeps(): Promise<DesktopUpdaterDeps | null> {
  const { isTauri } = await import("@tauri-apps/api/core");
  if (!isTauri()) return null;
  const [{ check }, { ask }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-process"),
  ]);
  return {
    check,
    ask: (message) =>
      ask(message, {
        title: "Update zvid",
        kind: "info",
        okLabel: "Install and Relaunch",
        cancelLabel: "Later",
      }),
    relaunch,
  };
}

/** Checks for a newer desktop build and, when the user accepts, installs it
 * and relaunches. On launch (`interactive` false) it stays quiet unless an
 * update is available; from the Help menu it reports every outcome through
 * `onStatus`. */
export async function checkForDesktopUpdate({
  interactive,
  onStatus = () => {},
  deps,
}: {
  interactive: boolean;
  onStatus?: (message: string) => void;
  deps?: DesktopUpdaterDeps;
}): Promise<DesktopUpdateResult | null> {
  const updater = deps ?? (await loadDesktopUpdaterDeps());
  if (!updater) return null;
  const report = (message: string) => {
    if (interactive) onStatus(message);
  };
  let update: DesktopUpdate | null;
  try {
    update = await updater.check();
  } catch (error) {
    console.warn("zvid: checking for updates failed", error);
    report("Couldn't check for updates. Try again later.");
    return "failed";
  }
  if (!update) {
    report("zvid is up to date.");
    return "up-to-date";
  }
  const accepted = await updater.ask(
    `zvid ${update.version} is available. Install it and relaunch zvid now?`,
  );
  if (!accepted) return "declined";
  onStatus(`Installing zvid ${update.version}…`);
  try {
    await update.downloadAndInstall();
  } catch (error) {
    console.warn("zvid: installing the update failed", error);
    onStatus(`Couldn't install zvid ${update.version}.`);
    return "failed";
  }
  await updater.relaunch();
  return "installed";
}
