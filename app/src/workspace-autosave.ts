// Schedules autosaves of the current session. A change is saved about
// `delayMs` after the last one, serialized in an idle callback so typing and
// playback stay smooth, and postponed while a drag or scrub is in progress so
// a gesture is saved once when it ends. `flush` saves pending changes at
// once, for `pagehide` and `visibilitychange: hidden`.

export const WORKSPACE_AUTOSAVE_DELAY_MS = 500;

export type WorkspaceAutosaveOptions = {
  // Builds the payload to store. Called once per save, off the hot path.
  serialize(): string;
  write(payload: string): Promise<void>;
  // True while a gesture (drag, scrub, knob turn) is in progress.
  isBusy(): boolean;
  onError?(error: unknown): void;
  delayMs?: number;
  setTimeout?(callback: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
  requestIdle?(callback: () => void): void;
};

export type WorkspaceAutosave = {
  // Notes that the session changed and schedules a save.
  markDirty(): void;
  // Saves pending changes now, ignoring the gesture guard.
  flush(): Promise<void>;
  // Drops pending changes without saving them.
  cancel(): void;
  isDirty(): boolean;
  dispose(): void;
};

function defaultRequestIdle(callback: () => void) {
  const idle = (
    globalThis as {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (idle) {
    idle(callback, { timeout: 1000 });
  } else {
    globalThis.setTimeout(callback, 0);
  }
}

export function createWorkspaceAutosave(
  options: WorkspaceAutosaveOptions,
): WorkspaceAutosave {
  const delayMs = options.delayMs ?? WORKSPACE_AUTOSAVE_DELAY_MS;
  const setTimer =
    options.setTimeout ??
    ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms));
  const clearTimer =
    options.clearTimeout ??
    ((handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const requestIdle = options.requestIdle ?? defaultRequestIdle;

  let dirty = false;
  let disposed = false;
  let timer: unknown = null;
  let idlePending = false;
  // Serializes writes so an older payload never lands after a newer one.
  let writing: Promise<void> = Promise.resolve();

  const clearPendingTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const save = () => {
    if (!dirty || disposed) {
      return writing;
    }
    dirty = false;
    let payload: string;
    try {
      payload = options.serialize();
    } catch (error) {
      options.onError?.(error);
      return writing;
    }
    writing = writing
      .then(() => options.write(payload))
      .catch((error: unknown) => options.onError?.(error));
    return writing;
  };

  const schedule = () => {
    clearPendingTimer();
    timer = setTimer(() => {
      timer = null;
      if (!dirty || disposed) {
        return;
      }
      if (options.isBusy()) {
        schedule();
        return;
      }
      if (idlePending) {
        return;
      }
      idlePending = true;
      requestIdle(() => {
        idlePending = false;
        if (options.isBusy()) {
          schedule();
          return;
        }
        void save();
      });
    }, delayMs);
  };

  return {
    markDirty() {
      if (disposed) {
        return;
      }
      dirty = true;
      schedule();
    },
    flush() {
      clearPendingTimer();
      return save();
    },
    cancel() {
      clearPendingTimer();
      dirty = false;
    },
    isDirty() {
      return dirty;
    },
    dispose() {
      clearPendingTimer();
      disposed = true;
    },
  };
}
