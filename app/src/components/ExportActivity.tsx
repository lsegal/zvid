import { XMarkIcon } from "@heroicons/react/24/solid";
import { useEffect } from "react";
import type { ExportActivity } from "../hooks/useExport.ts";
import "./export-activity.css";

// How long a successful export's notice stays; a failure's stays until
// dismissed.
const DONE_NOTICE_MS = 10_000;

// The status bar's running export: a mini progress bar and its label.
export function ExportProgressValue({
  activity,
}: {
  activity: Extract<ExportActivity, { kind: "running" }>;
}) {
  return (
    <span className="export-activity" data-export-activity="">
      <span
        aria-label="Background export progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={activity.progress ?? undefined}
        className={`export-activity__bar${
          activity.progress === null
            ? " export-activity__bar--indeterminate"
            : ""
        }`}
        role="progressbar"
      >
        <span style={{ width: `${activity.progress ?? 100}%` }} />
      </span>
      <span>{activity.label}</span>
    </span>
  );
}

// Says how an export that ended while its dialog was hidden went, with
// View reopening the dialog.
export function ExportNotice({
  activity,
  onView,
  onDismiss,
}: {
  activity: Extract<ExportActivity, { kind: "done" | "failed" }>;
  onView(): void;
  onDismiss(): void;
}) {
  useEffect(() => {
    if (activity.kind !== "done") {
      return;
    }
    const timer = window.setTimeout(onDismiss, DONE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [activity, onDismiss]);

  return (
    <div
      className={`export-notice export-notice--${activity.kind}`}
      data-export-notice={activity.kind}
      role={activity.kind === "failed" ? "alert" : "status"}
    >
      <span className="export-notice__text">{activity.label}</span>
      <button className="ghost-button" onClick={onView} type="button">
        View
      </button>
      <button
        aria-label="Dismiss"
        className="export-notice__dismiss"
        onClick={onDismiss}
        type="button"
      >
        <XMarkIcon aria-hidden="true" />
      </button>
    </div>
  );
}
