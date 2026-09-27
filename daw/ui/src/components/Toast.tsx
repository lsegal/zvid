import { useEffect, useState } from "react";
import type { Toast as ToastData } from "../state.ts";
import { Close } from "./icons.tsx";
import { StatusDot } from "./Status.tsx";

/** How long a toast stays up while not hovered or focused. */
const TOAST_MS = 5000;

type Props = { toast: ToastData | null; onDismiss: (id: number) => void };

/** The single toast slot, anchored above the footer and announced politely. */
export function Toast({ toast, onDismiss }: Props) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      )}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss, paused]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the timer
    <div
      className="toast"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <StatusDot tone={toast.tone} />
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
      >
        <Close />
      </button>
    </div>
  );
}
