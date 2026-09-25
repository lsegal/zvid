import type { Status } from "../ipc/types.ts";
import { Warning } from "./icons.tsx";

type Props = {
  status: Status;
  busy: boolean;
  onRecord: () => void;
  onStop: () => void;
};

export function CaptureCard({ status, busy, onRecord, onStop }: Props) {
  const capturing = status.phase === "capturing";
  const canRecord = status.phase === "ready";
  return (
    <section className="card capture-card" aria-label="Capture">
      {capturing ? (
        <button
          type="button"
          className="button primary is-capturing"
          onClick={onStop}
          disabled={busy}
          aria-busy={busy}
        >
          <span className="stop-square" aria-hidden />
          Stop capturing
        </button>
      ) : (
        <button
          type="button"
          className="button primary"
          onClick={onRecord}
          disabled={busy || !canRecord}
          aria-busy={busy}
        >
          <span className="record-dot" aria-hidden />
          Record
        </button>
      )}
      <p className="helper">
        <Warning className="helper-icon" />
        Arm capture before you start playback or recording in Live.
      </p>
      {capturing && (
        <p className="take-counter" aria-live="polite">
          Takes follow transport: {status.capture?.takes ?? 0}
        </p>
      )}
    </section>
  );
}
