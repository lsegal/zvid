import { useState } from "react";

// Whether each of the app's menu-opened dialogs is open.
export function useAppDialogs() {
  const [isCaptureInstallerDialogOpen, setIsCaptureInstallerDialogOpen] =
    useState(false);
  const [isOfflineMediaDialogOpen, setIsOfflineMediaDialogOpen] =
    useState(false);
  const [isMediaSyncDialogOpen, setIsMediaSyncDialogOpen] = useState(false);
  const [isMediaStorageDialogOpen, setIsMediaStorageDialogOpen] =
    useState(false);
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [isProjectExportDialogOpen, setIsProjectExportDialogOpen] =
    useState(false);

  return {
    isCaptureInstallerDialogOpen,
    setIsCaptureInstallerDialogOpen,
    isOfflineMediaDialogOpen,
    setIsOfflineMediaDialogOpen,
    isMediaSyncDialogOpen,
    setIsMediaSyncDialogOpen,
    isMediaStorageDialogOpen,
    setIsMediaStorageDialogOpen,
    isSessionSettingsOpen,
    setIsSessionSettingsOpen,
    isProjectExportDialogOpen,
    setIsProjectExportDialogOpen,
  };
}

export type AppDialogsState = ReturnType<typeof useAppDialogs>;
