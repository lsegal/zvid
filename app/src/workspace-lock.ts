// Makes sure only one tab autosaves the current session. The tab holding a
// Web Lock owns the saved session; another tab opening the app finds the lock
// taken and asks whether to take over or stay read-only. Taking over asks the
// owner over a BroadcastChannel to save its pending changes first, then steals
// the lock, which tells the old owner it has lost it.

export const WORKSPACE_LOCK_NAME = "zvid-workspace-session";
const FLUSH_TIMEOUT_MS = 1500;

type LockManagerLike = {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
};

type ChannelLike = {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
};

type LockMessage =
  | { type: "flush-request"; id: string }
  | { type: "flushed"; id: string };

export type WorkspaceLockOptions = {
  locks?: LockManagerLike | null;
  createChannel?: ((name: string) => ChannelLike) | null;
  name?: string;
  // Saves pending changes before another tab takes the session over.
  onFlushRequest?(): Promise<void>;
  // Called when another tab took the session over.
  onLost?(): void;
  flushTimeoutMs?: number;
};

export type WorkspaceLock = {
  // Tries to become the owner without waiting. True when this tab owns the
  // session afterwards, or when the browser cannot coordinate tabs at all.
  acquire(): Promise<boolean>;
  // Becomes the owner even if another tab holds the session.
  takeOver(): Promise<void>;
  isOwner(): boolean;
  // Gives up ownership and stops answering other tabs.
  dispose(): void;
};

function defaultLocks(): LockManagerLike | null {
  const navigatorLike = (
    globalThis as { navigator?: { locks?: LockManagerLike } }
  ).navigator;
  return navigatorLike?.locks ?? null;
}

function defaultChannel(name: string): ChannelLike | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }
  return new BroadcastChannel(name) as unknown as ChannelLike;
}

export function createWorkspaceLock(
  options: WorkspaceLockOptions = {},
): WorkspaceLock {
  const name = options.name ?? WORKSPACE_LOCK_NAME;
  const locks = options.locks === undefined ? defaultLocks() : options.locks;
  const channel =
    options.createChannel === null
      ? null
      : (options.createChannel ?? defaultChannel)(name);
  const flushTimeoutMs = options.flushTimeoutMs ?? FLUSH_TIMEOUT_MS;

  let owner = false;
  let releaseHeld: (() => void) | null = null;
  const pendingFlushes = new Map<string, () => void>();

  if (channel) {
    channel.onmessage = (event) => {
      const message = event.data as LockMessage | null;
      if (!message || typeof message !== "object") {
        return;
      }
      if (message.type === "flush-request" && owner) {
        void Promise.resolve(options.onFlushRequest?.())
          .catch(() => {})
          .finally(() => {
            channel.postMessage({
              type: "flushed",
              id: message.id,
            } satisfies LockMessage);
          });
      } else if (message.type === "flushed") {
        pendingFlushes.get(message.id)?.();
      }
    };
  }

  // Holds the lock until `release` or a steal, resolving `granted` once the
  // lock callback runs (or with false when it was not available).
  const hold = (requestOptions: { ifAvailable?: boolean; steal?: boolean }) =>
    new Promise<boolean>((resolveGranted) => {
      if (!locks) {
        owner = true;
        resolveGranted(true);
        return;
      }
      locks
        .request(name, requestOptions, (lock) => {
          if (!lock) {
            resolveGranted(false);
            return undefined;
          }
          owner = true;
          resolveGranted(true);
          return new Promise<void>((resolveHeld) => {
            releaseHeld = resolveHeld;
          });
        })
        .then(
          () => {
            owner = false;
          },
          () => {
            // A steal rejects the holder's request with an AbortError.
            const wasOwner = owner;
            owner = false;
            releaseHeld = null;
            resolveGranted(false);
            if (wasOwner) {
              options.onLost?.();
            }
          },
        );
    });

  const requestFlush = () =>
    new Promise<void>((resolve) => {
      if (!channel) {
        resolve();
        return;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const done = () => {
        pendingFlushes.delete(id);
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(done, flushTimeoutMs);
      pendingFlushes.set(id, done);
      channel.postMessage({ type: "flush-request", id } satisfies LockMessage);
    });

  return {
    acquire() {
      if (owner) {
        return Promise.resolve(true);
      }
      return hold({ ifAvailable: true });
    },
    async takeOver() {
      if (owner) {
        return;
      }
      await requestFlush();
      await hold({ steal: true });
    },
    isOwner() {
      return owner;
    },
    dispose() {
      owner = false;
      releaseHeld?.();
      releaseHeld = null;
      for (const done of pendingFlushes.values()) {
        done();
      }
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
    },
  };
}
