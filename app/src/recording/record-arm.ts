import { useSyncExternalStore } from "react";

// Which source tracks are armed for recording: every armed track records
// whenever recording starts. Local UI state, kept out of the session, its
// history and collaborators.
let armed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function setArmed(next: ReadonlySet<string>) {
  armed = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeArmedTracks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The armed source track IDs. A new set each time it changes. */
export function getArmedTrackIds() {
  return armed;
}

export function isTrackArmed(trackId: string) {
  return armed.has(trackId);
}

export function setTrackArmed(trackId: string, value: boolean) {
  if (armed.has(trackId) === value) {
    return;
  }
  const next = new Set(armed);
  if (value) {
    next.add(trackId);
  } else {
    next.delete(trackId);
  }
  setArmed(next);
}

export function toggleTrackArmed(trackId: string) {
  setTrackArmed(trackId, !armed.has(trackId));
}

// Disarms every track not in `trackIds`, so a removed track no longer
// records.
export function pruneArmedTracks(trackIds: Iterable<string>) {
  const present = new Set(trackIds);
  const next = new Set([...armed].filter((id) => present.has(id)));
  if (next.size !== armed.size) {
    setArmed(next);
  }
}

export function disarmAllTracks() {
  if (armed.size) {
    setArmed(new Set());
  }
}

export function useArmedTrackIds() {
  return useSyncExternalStore(subscribeArmedTracks, getArmedTrackIds);
}

export function useTrackArmed(trackId: string) {
  return useSyncExternalStore(subscribeArmedTracks, () => armed.has(trackId));
}
