import { formatFileSize } from "../export-options.ts";
import {
  describeExportTimeLeft,
  formatSnapshotTime,
} from "../export-progress.ts";
import type { ExportDialogModel } from "../hooks/useExport.ts";
import { formatTimecode } from "../timeline-format.ts";

type ExportActionsProps = {
  model: ExportDialogModel;
  canExport: boolean;
  estimateBytes: number;
  durationSeconds: number;
  frameCount: number;
  confirmCancel: boolean;
  setConfirmCancel(confirm: boolean): void;
};

// The Export dialog's actions and export status, under the output settings:
// the buttons first, then the progress bar and the render details.
export function ExportActions({
  model,
  canExport,
  estimateBytes,
  durationSeconds,
  frameCount,
  confirmCancel,
  setConfirmCancel,
}: ExportActionsProps) {
  const { phase } = model;
  const exporting = phase === "exporting";
  const progress = model.progress?.progress ?? null;

  return (
    <div className="export-actions" data-export-actions="">
      <div className="export-actions__buttons">
        {exporting ? (
          <>
            <button
              className="ghost-button"
              disabled={confirmCancel}
              onClick={() => setConfirmCancel(true)}
              type="button"
            >
              Cancel export
            </button>
            <button
              className="ghost-button ghost-button--accent"
              onClick={model.close}
              title="Hide this dialog; the export keeps running"
              type="button"
            >
              Run in background
            </button>
          </>
        ) : phase === "done" ? (
          <>
            {model.canReveal ? (
              <button
                className="ghost-button"
                onClick={model.revealFile}
                type="button"
              >
                Reveal file
              </button>
            ) : null}
            <button
              className="ghost-button"
              onClick={model.close}
              type="button"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <button
              className="ghost-button"
              onClick={model.close}
              type="button"
            >
              Cancel
            </button>
            <button
              className="ghost-button ghost-button--accent"
              disabled={!canExport}
              onClick={model.startExport}
              type="button"
            >
              Export
            </button>
          </>
        )}
      </div>

      {confirmCancel && exporting ? (
        <div className="export-actions__confirm" role="alertdialog">
          <span>Cancel the export in progress?</span>
          <button
            className="ghost-button"
            onClick={() => setConfirmCancel(false)}
            type="button"
          >
            Keep exporting
          </button>
          <button
            className="ghost-button ghost-button--accent"
            onClick={() => {
              setConfirmCancel(false);
              model.cancelExport();
            }}
            type="button"
          >
            Stop export
          </button>
        </div>
      ) : null}

      {exporting ? (
        <>
          <div
            aria-label="Export progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress ?? undefined}
            className={`export-actions__bar${
              progress === null ? " export-actions__bar--indeterminate" : ""
            }`}
            role="progressbar"
          >
            <span style={{ width: `${progress ?? 100}%` }} />
          </div>
          <div className="export-actions__progress-text">
            <span className="export-actions__detail">
              {model.progress?.detail ?? "Preparing export..."}
            </span>
            <span className="export-actions__time-left" data-export-time-left="">
              {describeExportTimeLeft(model.progress, model.secondsLeft)}
            </span>
          </div>
        </>
      ) : null}

      <span className="export-actions__estimate" data-export-estimate="">
        ≈ {formatFileSize(estimateBytes)} ·{" "}
        {formatTimecode(durationSeconds, model.options.fps)} ({frameCount}{" "}
        frames)
      </span>

      {model.snapshotTakenAt && phase !== "editing" ? (
        <p className="export-actions__note" data-export-snapshot="">
          {exporting
            ? `Exporting the version from ${formatSnapshotTime(
                model.snapshotTakenAt,
              )}. Edits made since don't change this export, and you can hide this dialog and keep working.`
            : `Exported the version from ${formatSnapshotTime(
                model.snapshotTakenAt,
              )}.`}
        </p>
      ) : null}

      {model.message ? (
        <p
          className={`export-actions__message${
            phase === "done" ? "" : " export-actions__message--error"
          }`}
          role="status"
        >
          {model.message}
        </p>
      ) : null}
    </div>
  );
}
