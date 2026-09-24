import type { WaveformPeaks } from "./waveform-peaks";

const DB_NAME = "zvid-media-cache";
const STORE_NAME = "media";
const PEAKS_STORE_NAME = "waveform-peaks";
const DB_VERSION = 2;

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

export function getCachedMediaBlob(id: string) {
  return runStoreRequest<Blob | null>("readonly", (store, resolve, reject) => {
    const request = store.get(id);
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to read cached media ${id}`));
    request.onsuccess = () => {
      const entry = request.result as CachedMediaEntry | undefined;
      resolve(entry?.blob ?? null);
    };
  });
}

export function cacheMediaBlob(id: string, blob: Blob) {
  return runStoreRequest<void>("readwrite", (store, resolve, reject) => {
    const request = store.put({
      id,
      blob,
      updatedAt: Date.now(),
    } satisfies CachedMediaEntry);
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to cache media ${id}`));
    request.onsuccess = () => resolve();
  });
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
