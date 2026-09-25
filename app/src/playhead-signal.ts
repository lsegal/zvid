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

// Playback moves the signal every frame but commits the playhead to React state
// only this often, or sooner when it crosses a clip edge, so the whole app does
// not re-render on every frame.
export const PLAYBACK_COMMIT_INTERVAL_MS = 250;

export type ClipSpanQ = { startQ: number; endQ: number };

// The next position after `playheadQ` where the clips under the playhead
// change, or Infinity when no clip edge is left. Edges sit `epsilon` early to
// match how clips are hit-tested at the playhead.
export function findNextClipEdgeQ(
  spans: Iterable<ClipSpanQ>,
  playheadQ: number,
  epsilon = 0.0001,
) {
  let nextQ = Number.POSITIVE_INFINITY;
  for (const { startQ, endQ } of spans) {
    for (const edgeQ of [startQ - epsilon, endQ - epsilon]) {
      if (edgeQ > playheadQ && edgeQ < nextQ) {
        nextQ = edgeQ;
      }
    }
  }
  return nextQ;
}
