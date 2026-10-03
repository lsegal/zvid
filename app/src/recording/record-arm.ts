import { useSyncExternalStore } from "react";

// Which source tracks are armed to record. Local UI state: it isn't saved to
// the session or synced to collaborators.

let armed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(next: ReadonlySet<string>) {
  armed = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getArmedTracks() {
  return armed;
}

export function isTrackArmed(trackId: string) {
  return armed.has(trackId);
}

export function setTrackArmed(trackId: string, isArmed: boolean) {
  if (armed.has(trackId) === isArmed) {
    return;
  }
  const next = new Set(armed);
  if (isArmed) {
    next.add(trackId);
  } else {
    next.delete(trackId);
  }
  update(next);
}

export function toggleTrackArmed(trackId: string) {
  setTrackArmed(trackId, !armed.has(trackId));
}

// Disarms tracks that no longer exist, such as after one is deleted.
export function pruneArmedTracks(trackIds: Iterable<string>) {
  const existing = new Set(trackIds);
  const next = new Set([...armed].filter((trackId) => existing.has(trackId)));
  if (next.size !== armed.size) {
    update(next);
  }
}

// The armed track IDs, re-rendering when they change.
export function useArmedTracks() {
  return useSyncExternalStore(subscribe, getArmedTracks, getArmedTracks);
}
