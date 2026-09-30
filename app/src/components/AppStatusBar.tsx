import { useMemo } from "react";
import { statusMessageTone } from "../status-bar";
import {
  type StatusBarItemsInputs,
  useStatusBarItems,
} from "../status-bar/useStatusBarItems.tsx";
import { StatusBar, type StatusMessage } from "./StatusBar";

export type AppStatusBarProps = StatusBarItemsInputs & {
  exportStatusText: string | null | undefined;
  status: string;
};

// The status bar at the bottom of the app: the items from the status
// registry, and the app status message, which a running export overrides.
export function AppStatusBar({
  exportStatusText,
  status,
  ...itemsInputs
}: AppStatusBarProps) {
  const statusMessage = useMemo<StatusMessage>(
    () =>
      exportStatusText
        ? {
            text: exportStatusText,
            tone: statusMessageTone(exportStatusText),
            sticky: true,
          }
        : { text: status, tone: statusMessageTone(status) },
    [exportStatusText, status],
  );

  const statusBarItems = useStatusBarItems(itemsInputs);

  return <StatusBar items={statusBarItems} message={statusMessage} />;
}
