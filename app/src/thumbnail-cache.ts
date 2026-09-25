// A shared cache of thumbnails decoded from media at a given time. Source
// spans and layer clips both ask for frames by (media, time), so a frame they
// have in common is only decoded once.
//
// Callers describe every thumbnail they currently need with `setWanted`. Each
// request names an owner, the span or clip showing it. When an owner moves to a
// new time, its previous thumbnail stays visible until the new one is ready,
// so trimming a clip does not flash an empty thumbnail. Object URLs are revoked
// as soon as nothing wants or shows them.

export type ThumbnailRequest<M> = {
  key: string;
  owner: string;
  media: M;
  // The media URL the frame is decoded from. A failed decode is retried when
  // this changes, e.g. after the media is relinked.
  sourceUrl: string;
  timeSeconds: number;
};

export type ThumbnailSnapshot = {
  get: (key: string, owner?: string) => string | undefined;
};

export type ThumbnailCache<M> = {
  setWanted: (requests: Iterable<ThumbnailRequest<M>>) => void;
  getSnapshot: () => ThumbnailSnapshot;
  subscribe: (listener: () => void) => () => void;
  // Revokes every thumbnail and forgets all requests. The cache stays usable.
  clear: () => void;
};

type ThumbnailEntry = {
  status: "pending" | "ready" | "failed";
  sourceUrl: string;
  url?: string;
};

export type ThumbnailCacheOptions<M> = {
  generate: (media: M, timeSeconds: number) => Promise<string | undefined>;
  revoke: (url: string) => void;
  // Decodes are expensive, so only this many run at once.
  concurrency?: number;
  // Coalesces change notifications so a burst of finished decodes re-renders
  // once. Defaults to a short timeout.
  scheduleNotify?: (notify: () => void) => void;
  onError?: (request: ThumbnailRequest<M>, error: unknown) => void;
};

export const DEFAULT_THUMBNAIL_CONCURRENCY = 4;

export function getThumbnailCacheKey(mediaId: string, timeSeconds: number) {
  return `${mediaId}:${timeSeconds.toFixed(3)}`;
}

type ClipThumbnailTiming = {
  trimStartSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
};

// The source time of the first frame the compositor shows for a clip. That is
// the clip's in-point, pulled inside its source window, since the compositor
// shows nothing for times outside the window, and inside the media.
export function getClipThumbnailTimeSeconds(
  clip: ClipThumbnailTiming,
  mediaDurationSeconds: number,
) {
  const lower = Math.max(0, clip.sourceWindowStartSeconds);
  let upper = clip.sourceWindowEndSeconds;
  if (mediaDurationSeconds > 0) {
    upper = Math.min(upper, mediaDurationSeconds);
  }

  const time = Math.max(clip.trimStartSeconds, lower);
  return upper > lower ? Math.min(time, upper) : lower;
}

export function createThumbnailCache<M>({
  generate,
  revoke,
  concurrency = DEFAULT_THUMBNAIL_CONCURRENCY,
  scheduleNotify = (notify) => {
    setTimeout(notify, 32);
  },
  onError,
}: ThumbnailCacheOptions<M>): ThumbnailCache<M> {
  const entries = new Map<string, ThumbnailEntry>();
  const wanted = new Map<string, ThumbnailRequest<M>>();
  // The key each owner currently asks for, and the key it last showed.
  const currentKeyByOwner = new Map<string, string>();
  const shownKeyByOwner = new Map<string, string>();
  const queue: string[] = [];
  const listeners = new Set<() => void>();
  let running = 0;
  // Bumped by `clear` so decodes started before it are discarded.
  let generation = 0;
  let notifyScheduled = false;

  const readUrl = (key: string | undefined) =>
    key === undefined ? undefined : entries.get(key)?.url;
  const createSnapshot = (): ThumbnailSnapshot => ({
    get(key, owner) {
      return (
        readUrl(key) ??
        (owner === undefined ? undefined : readUrl(shownKeyByOwner.get(owner)))
      );
    },
  });
  let snapshot = createSnapshot();

  function notify() {
    if (notifyScheduled) {
      return;
    }

    notifyScheduled = true;
    scheduleNotify(() => {
      notifyScheduled = false;
      snapshot = createSnapshot();
      for (const listener of listeners) {
        listener();
      }
    });
  }

  function isSettled(key: string) {
    const status = entries.get(key)?.status;
    return status === "ready" || status === "failed";
  }

  // Owners show their current thumbnail once it has settled.
  function updateShownKeys() {
    for (const [owner, key] of currentKeyByOwner) {
      if (isSettled(key) || !shownKeyByOwner.has(owner)) {
        shownKeyByOwner.set(owner, key);
      }
    }
    for (const owner of shownKeyByOwner.keys()) {
      if (!currentKeyByOwner.has(owner)) {
        shownKeyByOwner.delete(owner);
      }
    }
  }

  // Drops settled entries that nothing wants or shows. Pending entries stay so
  // a decode already running is not started twice; they are dropped when it
  // finishes, or skipped if it never started.
  function releaseUnused() {
    const shownKeys = new Set(shownKeyByOwner.values());
    let changed = false;
    for (const [key, entry] of entries) {
      if (entry.status === "pending" || wanted.has(key) || shownKeys.has(key)) {
        continue;
      }

      if (entry.url) {
        revoke(entry.url);
      }
      entries.delete(key);
      changed = true;
    }
    return changed;
  }

  function pump() {
    while (running < concurrency && queue.length) {
      const key = queue.shift() as string;
      const request = wanted.get(key);
      if (!request) {
        entries.delete(key);
        continue;
      }

      running += 1;
      void decode(request, generation);
    }
  }

  async function decode(request: ThumbnailRequest<M>, startedIn: number) {
    let url: string | undefined;
    let failed = false;
    try {
      url = await generate(request.media, request.timeSeconds);
    } catch (error) {
      failed = true;
      onError?.(request, error);
    }

    if (startedIn !== generation) {
      if (url) {
        revoke(url);
      }
      return;
    }

    running -= 1;
    const entry = entries.get(request.key);
    if (entry && wanted.has(request.key)) {
      entry.status = url && !failed ? "ready" : "failed";
      entry.url = url;
    } else {
      if (url) {
        revoke(url);
      }
      entries.delete(request.key);
    }

    updateShownKeys();
    releaseUnused();
    notify();
    pump();
  }

  return {
    setWanted(requests) {
      wanted.clear();
      currentKeyByOwner.clear();
      for (const request of requests) {
        currentKeyByOwner.set(request.owner, request.key);
        if (!wanted.has(request.key)) {
          wanted.set(request.key, request);
        }
      }

      let changed = false;
      for (const [key, request] of wanted) {
        const entry = entries.get(key);
        if (
          entry &&
          !(entry.status === "failed" && entry.sourceUrl !== request.sourceUrl)
        ) {
          continue;
        }

        entries.set(key, { status: "pending", sourceUrl: request.sourceUrl });
        queue.push(key);
        changed = true;
      }

      const previousShown = new Map(shownKeyByOwner);
      updateShownKeys();
      if (
        previousShown.size !== shownKeyByOwner.size ||
        [...shownKeyByOwner].some(([owner, key]) => previousShown.get(owner) !== key)
      ) {
        changed = true;
      }
      if (releaseUnused()) {
        changed = true;
      }
      if (changed) {
        notify();
      }
      pump();
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      generation += 1;
      running = 0;
      queue.length = 0;
      for (const entry of entries.values()) {
        if (entry.url) {
          revoke(entry.url);
        }
      }
      entries.clear();
      wanted.clear();
      currentKeyByOwner.clear();
      shownKeyByOwner.clear();
      notify();
    },
  };
}
