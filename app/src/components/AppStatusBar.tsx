import { useMemo } from "react";
import type { ExportActivity } from "../hooks/useExport.ts";
import { statusMessageTone } from "../status-bar";
import {
  type StatusBarItemsInputs,
  useStatusBarItems,
} from "../status-bar/useStatusBarItems.tsx";
import { ExportNotice, ExportProgressValue } from "./ExportActivity";
import { StatusBar, type StatusItem, type StatusMessage } from "./StatusBar";

export type AppStatusBarProps = StatusBarItemsInputs & {
  // A background export, shown while its dialog is hidden.
  exportActivity: ExportActivity | null;
  reopenExportDialog: () => void;
  dismissExportActivity: () => void;
  status: string;
};

// The status bar at the bottom of the app: the items from the status
// registry, a background export's progress, which reopens its dialog, and
// the app status message.
export function AppStatusBar({
  exportActivity,
  reopenExportDialog,
  dismissExportActivity,
  status,
  ...itemsInputs
}: AppStatusBarProps) {
  const statusMessage = useMemo<StatusMessage>(
    () => ({ text: status, tone: statusMessageTone(status) }),
    [status],
  );

  const registryItems = useStatusBarItems(itemsInputs);
  const running = exportActivity?.kind === "running" ? exportActivity : null;
  const statusBarItems = useMemo<StatusItem[]>(
    () =>
      running
        ? [
            {
              id: "export",
              align: "end",
              value: <ExportProgressValue activity={running} />,
              title: "Show the export in progress",
              onClick: reopenExportDialog,
            },
            ...registryItems,
          ]
        : registryItems,
    [registryItems, reopenExportDialog, running],
  );

  return (
    <>
      <StatusBar items={statusBarItems} message={statusMessage} />
      {exportActivity && exportActivity.kind !== "running" ? (
        <ExportNotice
          activity={exportActivity}
          onDismiss={dismissExportActivity}
          onView={reopenExportDialog}
        />
      ) : null}
    </>
  );
}
