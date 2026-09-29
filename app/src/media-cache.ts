import {
  createMediaStore,
  type MediaBackendKind,
  type MediaBlobBackend,
  type MediaIndex,
  type MediaIndexRecord,
} from "./media-store";
import { openOpfsMediaBackend } from "./opfs-media";
import {
  type CacheWriteResult,
  estimateStorage,
  getPersistence,
  requestPersistence,
  type StorageEstimate,
  type StoragePersistence,
} from "./storage-manager";
import type { WaveformPeaks } from "./waveform-peaks";

const DB_NAME = "zvid-media-cache";
const STORE_NAME = "media";
const PEAKS_STORE_NAME = "waveform-peaks";
const INDEX_STORE_NAME = "media-index";
const DB_VERSION = 3;

type CachedMediaEntry = {
  id: string;
  blob: Blob;
  updatedAt: number;
};

type CachedPeaksEntry = {
  id: string;
  // Fingerprint of the media content the peaks were decoded from; entries
  // without one predate content validation and are treated as stale.
  fingerprint?: string;
  peaks: WaveformPeaks;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to open media cache"));
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(PEAKS_STORE_NAME)) {
          database.createObjectStore(PEAKS_STORE_NAME, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(INDEX_STORE_NAME)) {
          database.createObjectStore(INDEX_STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  return dbPromise;
}

function runStoreRequest<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void,
  storeName = STORE_NAME,
) {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        operation(store, resolve, reject);
        transaction.onerror = () =>
          reject(
            transaction.error ??
              new Error(`Media cache ${mode} transaction failed`),
          );
      }),
  );
}

// Runs a write and resolves once it commits. Quota errors can surface only
// when the transaction aborts, after the request itself succeeded.
function runStoreWrite(
  operation: (store: IDBObjectStore) => void,
  storeName = STORE_NAME,
) {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        operation(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve();
        const fail = () =>
          reject(
            transaction.error ??
              new Error(`Media cache write to ${storeName} failed`),
          );
        transaction.onerror = fail;
        transaction.onabort = fail;
      }),
  );
}

function readAll<T>(storeName: string) {
  return runStoreRequest<T[]>(
    "readonly",
    (store, resolve, reject) => {
      const request = store.getAll();
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to read ${storeName}`));
      request.onsuccess = () => resolve(request.result as T[]);
    },
    storeName,
  );
}

const idbMediaBackend: MediaBlobBackend = {
  kind: "idb",
  read: (id) =>
    runStoreRequest<Blob | null>("readonly", (store, resolve, reject) => {
      const request = store.get(id);
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to read cached media ${id}`));
      request.onsuccess = () => {
        const entry = request.result as CachedMediaEntry | undefined;
        resolve(entry?.blob ?? null);
      };
    }),
  write: (id, blob) =>
    runStoreWrite((store) => {
      store.put({
        id,
        blob,
        updatedAt: Date.now(),
      } satisfies CachedMediaEntry);
    }),
  remove: (id) => runStoreWrite((store) => store.delete(id)),
  listIds: () =>
    runStoreRequest<string[]>("readonly", (store, resolve, reject) => {
      const request = store.getAllKeys();
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to list cached media"));
      request.onsuccess = () => resolve(request.result.map(String));
    }),
};

const mediaIndex: MediaIndex = {
  list: () => readAll<MediaIndexRecord>(INDEX_STORE_NAME),
  get: (id) =>
    runStoreRequest<MediaIndexRecord | null>(
      "readonly",
      (store, resolve, reject) => {
        const request = store.get(id);
        request.onerror = () =>
          reject(request.error ?? new Error(`Failed to read index for ${id}`));
        request.onsuccess = () =>
          resolve((request.result as MediaIndexRecord | undefined) ?? null);
      },
      INDEX_STORE_NAME,
    ),
  put: (record) => runStoreWrite((store) => store.put(record), INDEX_STORE_NAME),
  remove: (ids) =>
    runStoreWrite((store) => {
      for (const id of ids) {
        store.delete(id);
      }
    }, INDEX_STORE_NAME),
};

let opfsPromise: Promise<MediaBlobBackend | null> | null = null;
let persistencePromise: Promise<StoragePersistence> | null = null;

// Asks for persistent storage once per page, the first time media is cached.
export function ensurePersistentStorage() {
  persistencePromise ??= requestPersistence();
  return persistencePromise;
}

const mediaStore = createMediaStore({
  index: mediaIndex,
  idb: idbMediaBackend,
  opfs: () => {
    opfsPromise ??= openOpfsMediaBackend();
    return opfsPromise;
  },
  estimate: () => estimateStorage(),
  onWrite: () => void ensurePersistentStorage(),
});

export function getCachedMediaBlob(id: string) {
  return mediaStore.get(id);
}

// Resolves `skipped` instead of throwing when browser storage is full and no
// unused cached media could be evicted to make room.
export function cacheMediaBlob(
  id: string,
  blob: Blob,
): Promise<CacheWriteResult> {
  return mediaStore.put(id, blob);
}

// Marks the media the open session uses, protecting it from eviction.
export function setCachedMediaSession(session: string, ids: Iterable<string>) {
  return mediaStore.setSession(session, ids);
}

export function listCachedMedia() {
  return mediaStore.list();
}

// Removes cached files and returns the ids whose previously read `File`s are
// no longer readable.
export function removeCachedMedia(ids: readonly string[]) {
  return mediaStore.remove(ids);
}

// Moves media cached in IndexedDB by earlier versions into OPFS.
export function migrateMediaCache() {
  return mediaStore.migrate();
}

export type MediaStorageStatus = {
  persistence: StoragePersistence;
  estimate: StorageEstimate | null;
  backend: MediaBackendKind;
  records: MediaIndexRecord[];
  session: string;
  referencedIds: ReadonlySet<string>;
};

export async function getMediaStorageStatus(): Promise<MediaStorageStatus> {
  const [persistence, estimate, backend, records] = await Promise.all([
    persistencePromise ?? getPersistence(),
    estimateStorage(),
    mediaStore.backend(),
    mediaStore.list(),
  ]);
  const { name, referencedIds } = mediaStore.getSession();
  return {
    persistence,
    estimate,
    backend,
    records,
    session: name,
    referencedIds,
  };
}

// Returns cached peaks only when they were decoded from media with the given
// fingerprint, so replaced or relinked content under the same id is decoded
// again instead of showing the old waveform.
export function getCachedWaveformPeaks(id: string, fingerprint: string) {
  return runStoreRequest<WaveformPeaks | null>(
    "readonly",
    (store, resolve, reject) => {
      const request = store.get(id);
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to read peaks for ${id}`));
      request.onsuccess = () => {
        const entry = request.result as CachedPeaksEntry | undefined;
        resolve(entry?.fingerprint === fingerprint ? entry.peaks : null);
      };
    },
    PEAKS_STORE_NAME,
  );
}

export function cacheWaveformPeaks(
  id: string,
  fingerprint: string,
  peaks: WaveformPeaks,
) {
  return runStoreRequest<void>(
    "readwrite",
    (store, resolve, reject) => {
      const request = store.put({
        id,
        fingerprint,
        peaks,
        updatedAt: Date.now(),
      } satisfies CachedPeaksEntry);
      request.onerror = () =>
        reject(request.error ?? new Error(`Failed to cache peaks for ${id}`));
      request.onsuccess = () => resolve();
    },
    PEAKS_STORE_NAME,
  );
}
