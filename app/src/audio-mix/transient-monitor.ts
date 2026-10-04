// The main thread's view of the chain worklet's Transient levels (see
// StageModulator), for the Modulation section's graph. A graph watches its
// stage while it shows; the preview mixer tells its chain nodes which
// stages are watched and feeds their reports in here.
import type { ChainReport } from "./chain-node.ts";

const levels = new Map<string, number>();
// How many graphs watch each stage.
const watchers = new Map<string, number>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

// Asks for the Transient level of the stage `id` until the returned function
// is called.
export function watchTransient(id: string) {
  const count = watchers.get(id) ?? 0;
  watchers.set(id, count + 1);
  if (!count) {
    notify();
  }
  let watching = true;
  return () => {
    if (!watching) {
      return;
    }
    watching = false;
    const remaining = (watchers.get(id) ?? 1) - 1;
    if (remaining > 0) {
      watchers.set(id, remaining);
      return;
    }
    watchers.delete(id);
    levels.delete(id);
    notify();
  };
}

// The ids of the stages watched now.
export function watchedTransients(): string[] {
  return [...watchers.keys()];
}

// Calls `listener` whenever the watched stages change.
export function subscribeWatchedTransients(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Takes a chain node's report.
export function receiveTransientReport(report: ChainReport) {
  for (const [id, level] of report.levels) {
    if (watchers.has(id)) {
      levels.set(id, level);
    }
  }
}

// The stage's latest reported Transient level, 0 before its first report.
export function transientLevel(id: string) {
  return levels.get(id) ?? 0;
}
