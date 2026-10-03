// Which source tracks are armed for recording. It's this tab's UI state:
// not saved with the session, not in its history, not shared with
// collaborators.
import { useSyncExternalStore } from "react";

type Listener = () => void;

let armed: ReadonlySet<string> = new Set();
const listeners = new Set<Listener>();

function publish(next: ReadonlySet<string>) {
  armed = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeArmedTracks(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The armed source track IDs. The set is replaced, never mutated. */
export function getArmedTrackIds(): ReadonlySet<string> {
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
  publish(next);
}

export function toggleTrackArmed(trackId: string) {
  setTrackArmed(trackId, !armed.has(trackId));
}

/** Disarms tracks that are no longer in the session. */
export function pruneArmedTracks(trackIds: Iterable<string>) {
  const present = new Set(trackIds);
  const next = new Set([...armed].filter((id) => present.has(id)));
  if (next.size !== armed.size) {
    publish(next);
  }
}

/** Disarms every track. */
export function clearArmedTracks() {
  if (armed.size) {
    publish(new Set());
  }
}

/** The armed source track IDs, re-rendering when they change. */
export function useArmedTrackIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeArmedTracks,
    getArmedTrackIds,
    getArmedTrackIds,
  );
}
