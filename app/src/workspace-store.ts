// IndexedDB storage for the session that was open when the page closed, so a
// refresh brings it back. Media blobs stay in the media cache; this store only
// holds the serialized session (see workspace-session.ts).

const DB_NAME = "zvid-workspace";
const DB_VERSION = 1;
const SESSIONS_STORE = "sessions";
export const CURRENT_SESSION_KEY = "current";
const CORRUPT_KEY_PREFIX = "corrupt-";

// Bump when the record layout changes, and teach migrateWorkspaceRecord to
// read the previous version.
export const WORKSPACE_SCHEMA_VERSION = 1;

export type WorkspaceSessionRecord = {
  id: string;
  schemaVersion: number;
  savedAt: number;
  // The output of serializeWorkspaceSession.
  payload: string;
};

export type WorkspaceStore = {
  loadCurrentSession(): Promise<WorkspaceSessionRecord | null>;
  saveCurrentSession(
    record: Omit<WorkspaceSessionRecord, "id" | "schemaVersion">,
  ): Promise<void>;
  clearCurrentSession(): Promise<void>;
  // Moves the current record to a `corrupt-<timestamp>` key so it is kept
  // for inspection but no longer restored. Returns the key it was moved to.
  setAsideCurrentSession(now?: number): Promise<string | null>;
  close(): void;
};

// Upgrades a stored record to the current schema. Throws for records that
// cannot be read, which the caller sets aside as corrupt.
export function migrateWorkspaceRecord(raw: unknown): WorkspaceSessionRecord {
  if (!raw || typeof raw !== "object") {
    throw new Error("Saved session record is not an object");
  }
  const record = raw as Partial<WorkspaceSessionRecord>;
  if (record.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new Error(
      `Saved session has unsupported schema version ${String(record.schemaVersion)}`,
    );
  }
  if (typeof record.payload !== "string") {
    throw new Error("Saved session record has no payload");
  }
  return {
    id: typeof record.id === "string" ? record.id : CURRENT_SESSION_KEY,
    schemaVersion: record.schemaVersion,
    savedAt: typeof record.savedAt === "number" ? record.savedAt : 0,
    payload: record.payload,
  };
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Workspace store request failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Workspace store write aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Workspace store write failed"));
  });
}

export function createWorkspaceStore(factory?: IDBFactory): WorkspaceStore {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const openDatabase = () => {
    if (!dbPromise) {
      const indexedDB = factory ?? globalThis.indexedDB;
      if (!indexedDB) {
        return Promise.reject(new Error("IndexedDB is unavailable"));
      }
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
            database.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("Failed to open workspace store"));
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  };

  return {
    async loadCurrentSession() {
      const database = await openDatabase();
      const transaction = database.transaction(SESSIONS_STORE, "readonly");
      const raw = await requestResult(
        transaction.objectStore(SESSIONS_STORE).get(CURRENT_SESSION_KEY),
      );
      return raw === undefined ? null : migrateWorkspaceRecord(raw);
    },

    async saveCurrentSession(record) {
      const database = await openDatabase();
      const transaction = database.transaction(SESSIONS_STORE, "readwrite");
      transaction.objectStore(SESSIONS_STORE).put({
        ...record,
        id: CURRENT_SESSION_KEY,
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
      } satisfies WorkspaceSessionRecord);
      await transactionDone(transaction);
    },

    async clearCurrentSession() {
      const database = await openDatabase();
      const transaction = database.transaction(SESSIONS_STORE, "readwrite");
      transaction.objectStore(SESSIONS_STORE).delete(CURRENT_SESSION_KEY);
      await transactionDone(transaction);
    },

    async setAsideCurrentSession(now = Date.now()) {
      const database = await openDatabase();
      const transaction = database.transaction(SESSIONS_STORE, "readwrite");
      const store = transaction.objectStore(SESSIONS_STORE);
      const raw = await requestResult(store.get(CURRENT_SESSION_KEY));
      if (raw === undefined) {
        await transactionDone(transaction);
        return null;
      }
      const key = `${CORRUPT_KEY_PREFIX}${now}`;
      // Keep whatever was stored, even if it is not an object.
      store.put({ id: key, record: raw });
      store.delete(CURRENT_SESSION_KEY);
      await transactionDone(transaction);
      return key;
    },

    close() {
      const pending = dbPromise;
      dbPromise = null;
      void pending?.then((database) => database.close()).catch(() => {});
    },
  };
}

let defaultStore: WorkspaceStore | null = null;

export function getWorkspaceStore() {
  defaultStore ??= createWorkspaceStore();
  return defaultStore;
}

export function loadCurrentSession() {
  return getWorkspaceStore().loadCurrentSession();
}

export function saveCurrentSession(
  record: Omit<WorkspaceSessionRecord, "id" | "schemaVersion">,
) {
  return getWorkspaceStore().saveCurrentSession(record);
}

export function clearCurrentSession() {
  return getWorkspaceStore().clearCurrentSession();
}
