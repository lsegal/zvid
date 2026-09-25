import type { Status } from "../ipc/types.ts";
import { Refresh } from "./icons.tsx";
import { Spinner, StatusDot } from "./Status.tsx";

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
          <p>Connect a camera or choose one from the menu above.</p>
          <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
        </div>
      </section>
    );
  }

  if (status.phase === "error") {
    const code = status.error?.code;
    return (
      <section className="preview is-empty" aria-label="Camera preview">
        <div className="empty-state" role="alert">
          <StatusDot tone="warning" />
          {code === "permissionDenied" ? (
            <>
              <p className="message">Camera access is off for Ableton Live.</p>
              {platform === "macos" ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={onOpenPrivacySettings}
                >
                  Open Privacy Settings
                </button>
              ) : (
                <p>Turn it on in Settings › Privacy &amp; security › Camera.</p>
              )}
            </>
          ) : code === "deviceBusy" ? (
            <>
              <p className="message">This camera is in use by another app.</p>
              <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
            </>
          ) : (
            <>
              <p className="message">
                {status.error?.message ?? "The camera stopped working."}
              </p>
              <RefreshButton refreshing={refreshing} onRefresh={onRefresh} />
            </>
          )}
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
        <p className="preview-starting">
          <Spinner />
          Starting camera…
        </p>
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
      onClick={() => {
        if (!refreshing) onRefresh();
      }}
      aria-busy={refreshing}
    >
      {refreshing ? <Spinner /> : <Refresh />}
      Refresh devices
    </button>
  );
}
