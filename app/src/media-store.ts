// The cached media store behind `media-cache.ts`: media files live in OPFS
// where the browser supports it and in IndexedDB otherwise, with an index of
// sizes, last use and sessions that drives quota checks, eviction and the
// storage UI. Storage is passed in so the logic can be tested without a
// browser.

import { mediaBlobSource } from "./media.ts";
import {
  type CachedMediaRecord,
  type CacheWriteResult,
  isQuotaExceededError,
  type StorageEstimate,
  writeWithinQuota,
} from "./storage-manager.ts";

export type MediaBackendKind = "opfs" | "idb";

export type MediaBlobBackend = {
  kind: MediaBackendKind;
  read(id: string): Promise<Blob | null>;
  write(id: string, blob: Blob): Promise<void>;
  remove(id: string): Promise<void>;
  // Every stored id; the IndexedDB store uses it to find files to migrate.
  listIds?(): Promise<string[]>;
};

export type MediaIndexRecord = CachedMediaRecord & {
  backend: MediaBackendKind;
};

export type MediaIndex = {
  list(): Promise<MediaIndexRecord[]>;
  get(id: string): Promise<MediaIndexRecord | null>;
  put(record: MediaIndexRecord): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
};

export type MediaStoreOptions = {
  index: MediaIndex;
  idb: MediaBlobBackend;
  // Resolves to the OPFS backend, or null where OPFS isn't available.
  opfs: () => Promise<MediaBlobBackend | null>;
  estimate: () => Promise<StorageEstimate | null>;
  // Called before the first write, to ask for persistent storage.
  onWrite?: () => void;
  now?: () => number;
};

function withSession(sessions: readonly string[], session: string) {
  if (!session || sessions.at(-1) === session) {
    return [...sessions];
  }
  return [...sessions.filter((name) => name !== session), session];
}

export function createMediaStore({
  index,
  idb,
  opfs,
  estimate,
  onWrite,
  now = Date.now,
}: MediaStoreOptions) {
  let session = "";
  let referencedIds: ReadonlySet<string> = new Set();
  // OPFS files handed to callers. Rewriting or deleting the underlying file
  // makes these unreadable, so they're tracked by id.
  const openFiles = new Map<string, Blob>();

  async function backendFor(kind: MediaBackendKind) {
    return kind === "opfs" ? await opfs() : idb;
  }

  async function touch(
    id: string,
    blob: Blob,
    record: MediaIndexRecord | null,
  ) {
    await index.put({
      id,
      size: record?.size ?? blob.size,
      lastUsedAt: now(),
      sessions: withSession(record?.sessions ?? [], session),
      backend: record?.backend ?? "idb",
    });
  }

  async function get(id: string) {
    const record = await index.get(id);
    // Files cached before the index existed are in IndexedDB.
    const backend = await backendFor(record?.backend ?? "idb");
    if (!backend) {
      // OPFS is unavailable right now; keep the entry for a later read.
      return null;
    }
    const blob = await backend.read(id);
    if (!blob) {
      if (record) {
        await index.remove([id]);
      }
      return null;
    }
    if (backend.kind === "opfs") {
      openFiles.set(id, blob);
    }
    await touch(id, blob, record);
    return blob;
  }

  async function remove(ids: readonly string[]) {
    const invalidated: string[] = [];
    const opfsBackend = await opfs();
    for (const id of ids) {
      await idb.remove(id);
      await opfsBackend?.remove(id);
      if (openFiles.delete(id)) {
        invalidated.push(id);
      }
    }
    await index.remove(ids);
    return invalidated;
  }

  async function writeBlob(id: string, blob: Blob) {
    const opfsBackend = await opfs();
    let kind: MediaBackendKind = "idb";
    if (opfsBackend) {
      try {
        await opfsBackend.write(id, blob);
        kind = "opfs";
      } catch (error) {
        if (isQuotaExceededError(error)) {
          throw error;
        }
        // Anything else is an OPFS problem; IndexedDB may still work.
      }
    }
    if (kind === "idb") {
      await idb.write(id, blob);
    }

    const previous = await index.get(id);
    if (previous && previous.backend !== kind) {
      await (await backendFor(previous.backend))?.remove(id);
    }
    if (kind === "opfs") {
      // The old file handed out for this id was replaced.
      openFiles.delete(id);
    }
    await index.put({
      id,
      size: blob.size,
      lastUsedAt: now(),
      sessions: withSession(previous?.sessions ?? [], session),
      backend: kind,
    });
  }

  async function put(id: string, blob: Blob): Promise<CacheWriteResult> {
    // The caller is re-caching the file it read from the cache, perhaps
    // typed as an SVG: rewriting it would only invalidate the File it holds,
    // and reading that File into its own replacement can leave it empty.
    if (openFiles.get(id) === mediaBlobSource(blob)) {
      await touch(id, blob, await index.get(id));
      return { status: "cached" };
    }

    onWrite?.();
    return writeWithinQuota({
      id,
      size: blob.size,
      referencedIds,
      estimate,
      listRecords: () => index.list(),
      evict: async (ids) => {
        await remove(ids);
      },
      write: () => writeBlob(id, blob),
    });
  }

  // Records which media the open session uses. Those files are never
  // evicted, and they count as used now.
  async function setSession(name: string, ids: Iterable<string>) {
    session = name;
    referencedIds = new Set(ids);
    const time = now();
    for (const record of await index.list()) {
      if (referencedIds.has(record.id)) {
        await index.put({
          ...record,
          lastUsedAt: time,
          sessions: withSession(record.sessions, name),
        });
      }
    }
  }

  // Moves files cached in IndexedDB into OPFS, deleting each IndexedDB copy
  // once its OPFS copy is written. Without OPFS it only indexes files cached
  // before the index existed, as least recently used.
  async function migrate() {
    const ids = (await idb.listIds?.()) ?? [];
    if (!ids.length) {
      return 0;
    }
    const opfsBackend = await opfs();
    const records = new Map(
      (await index.list()).map((record) => [record.id, record]),
    );
    let moved = 0;
    for (const id of ids) {
      const record = records.get(id);
      if (record?.backend === "opfs") {
        await idb.remove(id);
        continue;
      }
      if (!opfsBackend && record) {
        continue;
      }
      const blob = await idb.read(id);
      if (!blob) {
        continue;
      }
      let kind: MediaBackendKind = "idb";
      if (opfsBackend) {
        try {
          await opfsBackend.write(id, blob);
          kind = "opfs";
        } catch {
          // Leave it in IndexedDB; the next run tries again.
        }
      }
      await index.put({
        id,
        size: blob.size,
        lastUsedAt: record?.lastUsedAt ?? 0,
        sessions: record?.sessions ?? [],
        backend: kind,
      });
      if (kind === "opfs") {
        await idb.remove(id);
        moved += 1;
      }
    }
    return moved;
  }

  return {
    get,
    put,
    remove,
    setSession,
    migrate,
    list: () => index.list(),
    getSession: () => ({ name: session, referencedIds }),
    backend: async (): Promise<MediaBackendKind> =>
      (await opfs()) ? "opfs" : "idb",
  };
}

export type MediaStore = ReturnType<typeof createMediaStore>;
