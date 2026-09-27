import { useId } from "react";
import { captureControls } from "../capture.ts";
import type { Status } from "../ipc/types.ts";
import { Spinner, VisuallyHidden } from "./Status.tsx";

type Props = {
  status: Status;
  busy: boolean;
  onRecord: () => void;
  onStop: () => void;
};

export function CaptureCard({ status, busy, onRecord, onStop }: Props) {
  const reason = useId();
  const controls = captureControls(status);
  const capturing = controls.button === "stop";
  // Disabled buttons stay focusable so their explanation is reachable.
  const disabled = !capturing && status.phase !== "ready";
  const activate = () => {
    if (busy || disabled) return;
    if (capturing) onStop();
    else onRecord();
  };
  return (
    <section className="card capture-card" aria-label="Capture">
      {controls.button && (
        <button
          type="button"
          className="button primary"
          onClick={activate}
          aria-disabled={disabled || undefined}
          aria-busy={busy || undefined}
          aria-describedby={disabled ? reason : undefined}
        >
          {busy ? (
            <Spinner />
          ) : (
            <span
              className={capturing ? "stop-glyph" : "record-glyph"}
              aria-hidden="true"
            />
          )}
          {capturing ? "Stop capturing" : "Record"}
        </button>
      )}
      {controls.button && disabled && (
        <VisuallyHidden id={reason}>Choose a camera to record</VisuallyHidden>
      )}
      {controls.following && <LiveFollowing armed={controls.following.armed} />}
      <p className="helper">{controls.helper}</p>
      {status.phase === "capturing" && (
        <p className="take-counter">
          Takes follow transport: {status.capture?.takes ?? 0}
        </p>
      )}
    </section>
  );
}

/** Read-only stand-in for Record while Live's record buttons arm capture. */
function LiveFollowing({ armed }: { armed: boolean }) {
  return (
    <div className={`live-following${armed ? " is-armed" : ""}`} role="status">
      <span className="live-following-label">
        Following Live's record button
      </span>
      <span className="live-following-state">
        <span className="live-record-glyph" aria-hidden="true" />
        {armed ? "Record on in Live" : "Record off in Live"}
      </span>
    </div>
  );
}
