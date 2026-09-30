import {
  formatSampleProgress,
  type SampleLoadProgress,
} from "../sample/sample-loader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export type SampleLoadState =
  | { status: "idle" }
  | { status: "loading"; progress: SampleLoadProgress }
  | { status: "failed"; message: string };

type SampleLoadDialogProps = {
  state: SampleLoadState;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
};

// Shows the sample's media downloading, with Cancel, and a failed load with
// Retry. Nothing is opened until every asset has loaded.
export function SampleLoadDialog({
  state,
  onCancel,
  onRetry,
  onDismiss,
}: SampleLoadDialogProps) {
  const open = state.status !== "idle";
  const percent =
    state.status === "loading" && state.progress.totalBytes > 0
      ? Math.round(
          (state.progress.loadedBytes / state.progress.totalBytes) * 100,
        )
      : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          if (state.status === "loading") {
            onCancel();
          } else {
            onDismiss();
          }
        }
      }}
    >
      <DialogContent className="offline-media-dialog sample-load-dialog">
        <DialogHeader>
          <DialogTitle>
            {state.status === "failed"
              ? "Could not open the sample"
              : "Opening the zvid sample"}
          </DialogTitle>
          <DialogDescription>
            {state.status === "failed"
              ? state.message
              : "Loading the sample's video and music. It opens once every file is ready."}
          </DialogDescription>
        </DialogHeader>
        {state.status === "loading" ? (
          <div className="media-sync-dialog__progress">
            <div
              aria-label="Sample media progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={percent}
              className="media-sync-dialog__bar"
              role="progressbar"
            >
              <span
                className="media-sync-dialog__bar-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <small className="media-sync-dialog__bytes">
              {`${percent}% · ${formatSampleProgress(state.progress)}`}
              {state.progress.current ? ` · ${state.progress.current}` : ""}
            </small>
          </div>
        ) : null}
        <DialogFooter className="offline-media__footer">
          {state.status === "failed" ? (
            <>
              <button
                className="ghost-button"
                onClick={onDismiss}
                type="button"
              >
                Close
              </button>
              <button
                className="ghost-button ghost-button--accent"
                onClick={onRetry}
                type="button"
              >
                Retry
              </button>
            </>
          ) : (
            <button className="ghost-button" onClick={onCancel} type="button">
              Cancel
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
