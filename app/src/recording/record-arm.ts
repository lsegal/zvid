import { useCallback, useSyncExternalStore } from "react";

// Which source tracks are armed to record when the transport's Record
// button is pressed. Arming is local UI state: it isn't saved to the
// session or synced to collaborators.

let armed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function update(next: ReadonlySet<string>) {
  armed = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeRecordArm(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The armed tracks' IDs. The set is replaced, never changed, so it can be
// a useSyncExternalStore snapshot.
export function getArmedTracks() {
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
  update(next);
}

export function toggleTrackArmed(trackId: string) {
  setTrackArmed(trackId, !armed.has(trackId));
}

export function disarmAllTracks() {
  if (armed.size) {
    update(new Set());
  }
}

// Whether a track is armed, and a setter, kept in step with every other
// arm button for the track.
export function useTrackArmed(trackId: string) {
  const isArmed = useSyncExternalStore(subscribeRecordArm, () =>
    armed.has(trackId),
  );
  const setArmed = useCallback(
    (value: boolean) => setTrackArmed(trackId, value),
    [trackId],
  );
  return [isArmed, setArmed] as const;
}
