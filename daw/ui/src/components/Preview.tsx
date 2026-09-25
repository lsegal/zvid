import type { Status } from "../ipc/types.ts";
import { CameraOff, Refresh, Warning } from "./icons.tsx";

type Props = {
  status: Status;
  frameUrl: string | null;
  platform: string | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenPrivacySettings: () => void;
};

export function Preview({
  status,
  frameUrl,
  platform,
  refreshing,
  onRefresh,
  onOpenPrivacySettings,
}: Props) {
  if (status.phase === "noCamera") {
    return (
      <section className="preview is-empty" aria-label="Camera preview">
        <div className="empty-state">
          <h2>No camera selected</h2>
          <p>
            Choose a webcam, Continuity Camera or phone webcam from the menu
            above.
          </p>
          <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
        </div>
      </section>
    );
  }

  if (status.phase === "error") {
    const denied = status.error?.code === "permissionDenied";
    const busy = status.error?.code === "deviceBusy";
    return (
      <section className="preview is-error" aria-label="Camera preview">
        <div className="empty-state" role="alert">
          {denied ? (
            <CameraOff className="state-icon" />
          ) : (
            <Warning className="state-icon" />
          )}
          <h2>
            {denied
              ? "Camera access is off"
              : busy
                ? "Camera is in use"
                : "Camera unavailable"}
          </h2>
          <p>{status.error?.message}</p>
          {denied && (
            <button
              type="button"
              className="link-button"
              onClick={onOpenPrivacySettings}
            >
              {platform === "macos"
                ? "Open Privacy Settings"
                : "Open camera privacy settings"}
            </button>
          )}
          <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
        </div>
      </section>
    );
  }

  return (
    <section className="preview" aria-label="Camera preview">
      {frameUrl ? (
        <img
          className="preview-frame"
          src={frameUrl}
          alt="Live camera preview"
        />
      ) : (
        <p className="preview-waiting">Waiting for camera…</p>
      )}
    </section>
  );
}

function RefreshButton({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <button
      type="button"
      className="button secondary"
      onClick={onRefresh}
      disabled={refreshing}
      aria-busy={refreshing}
    >
      <Refresh className={refreshing ? "spin" : undefined} />
      Refresh devices
    </button>
  );
}
