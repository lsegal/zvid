import { formatTimer } from "../format.ts";
import type { Phase } from "../ipc/types.ts";

/** An 8 pt state-colour circle; always paired with visible text. */
export function StatusDot({ tone }: { tone: Phase | "warning" | "onAccent" }) {
  return <span className={`status-dot is-${tone}`} aria-hidden="true" />;
}

/** Elapsed capture time on a pink pill; a timer, so not announced each second. */
export function TimerPill({ ms }: { ms: number }) {
  return (
    <span className="timer-pill" role="timer" aria-label="Capture time">
      <StatusDot tone="onAccent" />
      {formatTimer(ms)}
    </span>
  );
}

/** A small busy indicator that keeps its host's size. */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** Text for assistive technology only. */
export function VisuallyHidden({
  id,
  children,
}: {
  id?: string;
  children: string;
}) {
  return (
    <span id={id} className="visually-hidden">
      {children}
    </span>
  );
}
