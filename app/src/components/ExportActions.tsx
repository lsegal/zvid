import { formatFileSize } from "../export-options.ts";
import {
  describeExportTimeLeft,
  formatSnapshotTime,
} from "../export-progress.ts";
import type { ExportDialogModel } from "../hooks/useExport.ts";
import { formatTimecode } from "../timeline-format.ts";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type ExportActionsProps = {
  model: ExportDialogModel;
  canExport: boolean;
  confirmCancel: boolean;
  setConfirmCancel(confirm: boolean): void;
};

// The Export dialog's actions, under its title: the progress bar while
// exporting with the export's status below it, then the buttons.
export function ExportActions({
  model,
  canExport,
  confirmCancel,
  setConfirmCancel,
}: ExportActionsProps) {
  const { phase } = model;
  const exporting = phase === "exporting";
  const progress = model.progress?.progress ?? null;

  return (
    <div className="export-actions" data-export-actions="">
      <div className="export-actions__progress">
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
        <ExportProgressStatus model={model} />
      </div>

      <div className="export-actions__buttons">
        {exporting ? (
          <>
            <button
              className="ghost-button"
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

      <Dialog
        open={confirmCancel && exporting}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmCancel(false);
          }
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="export-cancel-confirm"
          // The Export dialog's playback keys and the editor's shortcuts
          // stay out of the confirmation.
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => event.stopPropagation()}
          role="alertdialog"
        >
          <DialogHeader>
            <DialogTitle>Cancel the export in progress?</DialogTitle>
          </DialogHeader>
          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The export's status, under the progress bar: what it is doing and the time
// left while exporting, then how it ended.
function ExportProgressStatus({ model }: { model: ExportDialogModel }) {
  const { phase } = model;
  const exporting = phase === "exporting";
  const snapshot = phase === "done" ? model.snapshotTakenAt : null;
  if (!exporting && !snapshot && !model.message) {
    return null;
  }

  return (
    <div className="export-actions__status" data-export-progress-status="">
      {exporting ? (
        <div className="export-actions__progress-text">
          <span className="export-actions__detail">
            {model.progress?.detail ?? "Preparing export..."}
          </span>
          <span className="export-actions__time-left" data-export-time-left="">
            {describeExportTimeLeft(model.progress, model.secondsLeft)}
          </span>
        </div>
      ) : null}

      {snapshot ? (
        <p className="export-actions__note" data-export-snapshot="">
          {`Exported the version from ${formatSnapshotTime(snapshot)}.`}
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

type ExportStatusProps = {
  model: ExportDialogModel;
  estimateBytes: number;
  durationSeconds: number;
  frameCount: number;
};

// The export's estimate, under the output settings.
export function ExportStatus({
  model,
  estimateBytes,
  durationSeconds,
  frameCount,
}: ExportStatusProps) {
  return (
    <div className="export-status" data-export-status="">
      <span className="export-status__estimate" data-export-estimate="">
        ≈ {formatFileSize(estimateBytes)} ·{" "}
        {formatTimecode(durationSeconds, model.options.fps)} ({frameCount}{" "}
        frames)
      </span>
    </div>
  );
}
