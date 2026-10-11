// A short buzz each time a finger drag lands on a new snap point, on
// platforms with a vibration motor the browser exposes (Android).

const SNAP_BUZZ_MS = 8;

function vibrateDevice(ms: number) {
  if (typeof navigator !== "undefined") {
    navigator.vibrate?.(ms);
  }
}

export type SnapFeedback = {
  // Records where the drag snapped to; returns whether it buzzed.
  update: (pointerType: string, snapped: boolean, valueQ: number) => boolean;
  // Forgets the last snap point, at the end of a drag.
  reset: () => void;
};

export function createSnapFeedback(vibrate = vibrateDevice): SnapFeedback {
  let lastQ: number | null = null;
  return {
    update(pointerType, snapped, valueQ) {
      const buzz =
        pointerType === "touch" &&
        snapped &&
        lastQ !== null &&
        Math.abs(lastQ - valueQ) > 1e-9;
      lastQ = valueQ;
      if (buzz) {
        vibrate(SNAP_BUZZ_MS);
      }
      return buzz;
    },
    reset() {
      lastQ = null;
    },
  };
}
