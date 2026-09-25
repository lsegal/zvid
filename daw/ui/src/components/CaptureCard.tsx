import { useId } from "react";
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
  const capturing = status.phase === "capturing";
  // Disabled buttons stay focusable so their explanation is reachable.
  const disabled = !capturing && status.phase !== "ready";
  const activate = () => {
    if (busy || disabled) return;
    if (capturing) onStop();
    else onRecord();
  };
  return (
    <section className="card capture-card" aria-label="Capture">
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
      {disabled && (
        <VisuallyHidden id={reason}>Choose a camera to record</VisuallyHidden>
      )}
      <p className="helper">
        Arm capture before you start playback or recording in Live.
      </p>
      {capturing && (
        <p className="take-counter">
          Takes follow transport: {status.capture?.takes ?? 0}
        </p>
      )}
    </section>
  );
}
