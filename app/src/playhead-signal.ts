// A subscribable playhead position. Small readouts subscribe to it so they can
// refresh on their own without the components around them re-rendering.

export type PlayheadSignal = {
  get: () => number;
  set: (playheadQ: number) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createPlayheadSignal(initialQ = 0): PlayheadSignal {
  let playheadQ = initialQ;
  const listeners = new Set<() => void>();
  return {
    get: () => playheadQ,
    set(next) {
      if (next === playheadQ) {
        return;
      }
      playheadQ = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
