// Asks the FX panel to show a source track's Synth device, as the track
// handle's instrument button does: the panel unfolds, and so does the
// device. Each request has a new serial, so asking again for the same track
// reveals the device again after it was folded.
import { useSyncExternalStore } from "react";

export type SynthDeviceReveal = { trackId: string; serial: number };

let current: SynthDeviceReveal | null = null;
const listeners = new Set<() => void>();

/** Asks the FX panel to show `trackId`'s Synth device. */
export function revealSynthDevice(trackId: string) {
  current = { trackId, serial: (current?.serial ?? 0) + 1 };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The latest request to show a Synth device, if any. */
export function useSynthDeviceReveal() {
  return useSyncExternalStore(subscribe, () => current);
}
