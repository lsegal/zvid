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

// The Export dialog's actions, at its top right: the estimate, then the
// progress bar while exporting, then the buttons.
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
      <div className="export-actions__row">
        <span className="export-actions__estimate" data-export-estimate="">
          ≈ {formatFileSize(estimateBytes)} ·{" "}
          {formatTimecode(durationSeconds, model.options.fps)} ({frameCount}{" "}
          frames)
        </span>

        {exporting ? (
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
        ) : null}

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
            <button
              className="ghost-button ghost-button--accent"
              disabled={!canExport}
              onClick={model.startExport}
              type="button"
            >
              Export
            </button>
          )}
        </div>
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
    </div>
  );
}

// The export's status, under the output settings: what it is doing and the
// time left while exporting, then how it ended.
export function ExportStatus({ model }: { model: ExportDialogModel }) {
  const { phase } = model;
  const exporting = phase === "exporting";
  const snapshot = phase === "done" ? model.snapshotTakenAt : null;
  if (!exporting && !snapshot && !model.message) {
    return null;
  }

  return (
    <div className="export-status" data-export-status="">
      {exporting ? (
        <div className="export-status__progress-text">
          <span className="export-status__detail">
            {model.progress?.detail ?? "Preparing export..."}
          </span>
          <span className="export-status__time-left" data-export-time-left="">
            {describeExportTimeLeft(model.progress, model.secondsLeft)}
          </span>
        </div>
      ) : null}

      {snapshot ? (
        <p className="export-status__note" data-export-snapshot="">
          {`Exported the version from ${formatSnapshotTime(snapshot)}.`}
        </p>
      ) : null}

      {model.message ? (
        <p
          className={`export-status__message${
            phase === "done" ? "" : " export-status__message--error"
          }`}
          role="status"
        >
          {model.message}
        </p>
      ) : null}
    </div>
  );
}
