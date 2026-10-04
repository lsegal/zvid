// How long each take of a recording pass is so far, kept outside React state
// so the live tick only re-renders the growing clips that subscribe to it,
// not the app around them.

export class LiveTakeStore {
  private readonly seconds = new Map<string, number>();
  private readonly ended = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(trackIds: Iterable<string> = []) {
    for (const trackId of trackIds) {
      this.seconds.set(trackId, 0);
    }
  }

  /** Calls `listener` whenever a duration changes; returns an unsubscribe. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** How long `trackId`'s take is so far, in seconds. */
  durationSeconds(trackId: string) {
    return this.seconds.get(trackId) ?? 0;
  }

  /** Grows every take that is still recording to `elapsedSeconds`. */
  advance(elapsedSeconds: number) {
    let changed = false;
    for (const [trackId, seconds] of this.seconds) {
      if (!this.ended.has(trackId) && seconds !== elapsedSeconds) {
        this.seconds.set(trackId, elapsedSeconds);
        changed = true;
      }
    }
    if (changed) {
      for (const listener of this.listeners) listener();
    }
  }

  /** Stops `trackId`'s take growing, at the length it has reached. */
  end(trackId: string) {
    this.ended.add(trackId);
  }
}

/**
 * Where the timeline should make room up to while takes record from
 * `startQ` for `elapsedQ` quarters: the end of the bar the takes are in, so
 * the timeline only grows once a bar rather than on every tick.
 */
export function recordingEndStepQ(
  startQ: number,
  elapsedQ: number,
  barQuarters: number,
) {
  if (!(barQuarters > 0)) return startQ + elapsedQ;
  const bars = Math.max(1, Math.ceil(elapsedQ / barQuarters));
  return startQ + bars * barQuarters;
}
