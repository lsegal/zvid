import { useEffect } from "react";
import type { Toast } from "../state.ts";
import { Close } from "./icons.tsx";

/** How long an error toast stays up. */
const TOAST_MS = 6000;

type Props = { toasts: Toast[]; onDismiss: (id: number) => void };

export function Toasts({ toasts, onDismiss }: Props) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);
  return (
    <div className="toast">
      <span>{toast.message}</span>
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
