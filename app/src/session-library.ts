// IndexedDB storage for the Sessions library: every session that was saved
// or opened, each kept as its own entry until the user deletes it. Like the
// workspace store, an entry holds only the serialized session (see
// workspace-session.ts); its media stays in the media cache.

const DB_NAME = "zvid-session-library";
const DB_VERSION = 1;
const ENTRIES_STORE = "entries";

export const SESSION_LIBRARY_UNTITLED = "Untitled Session";

export type SessionLibraryEntry = {
  id: string;
  name: string;
  createdAt: number;
  // When the entry was last saved or opened; the list is sorted by it.
  updatedAt: number;
  clipCount: number;
  // The output of serializeWorkspaceSession, with the undo history dropped.
  payload: string;
};

// What the list shows; the payload is read only when an entry is opened.
export type SessionLibrarySummary = Omit<SessionLibraryEntry, "payload">;

export type SessionLibraryStore = {
  list(): Promise<SessionLibrarySummary[]>;
  get(id: string): Promise<SessionLibraryEntry | null>;
  put(entry: SessionLibraryEntry): Promise<void>;
  // Changes some fields of an entry. Resolves false when it is gone.
  update(
    id: string,
    patch: Partial<Omit<SessionLibraryEntry, "id">>,
  ): Promise<boolean>;
  delete(id: string): Promise<void>;
  close(): void;
};

export function createSessionLibraryId() {
  return `session-${globalThis.crypto.randomUUID()}`;
}

// The name a session gets in the library: its own name without a file
// extension, or Untitled Session.
export function getSessionLibraryName(sessionName: string | null | undefined) {
  const name = (sessionName ?? "").trim().replace(/\.(lvp|zvd|als)$/i, "");
  return name || SESSION_LIBRARY_UNTITLED;
}

// "Name copy", then "Name copy 2", "Name copy 3"… skipping names in use.
export function getDuplicateName(name: string, existing: readonly string[]) {
  const taken = new Set(existing);
  const base = `${name} copy`;
  if (!taken.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

// Newest first.
export function sortSessionLibrary<
  T extends Pick<SessionLibrarySummary, "updatedAt">,
>(entries: readonly T[]) {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

const RELATIVE_UNITS = [
  { unit: "day", seconds: 86_400 },
  { unit: "hour", seconds: 3_600 },
  { unit: "minute", seconds: 60 },
] as const;

// "Just now", "5 minutes ago", "Yesterday"; a date after a week.
export function formatSessionTime(time: number, now = Date.now()) {
  const elapsed = Math.max(0, (now - time) / 1000);
  if (elapsed < 60) {
    return "Just now";
  }
  if (elapsed < 7 * 86_400) {
    const format = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
    for (const { unit, seconds } of RELATIVE_UNITS) {
      if (elapsed >= seconds) {
        const value = Math.floor(elapsed / seconds);
        const text = format.format(-value, unit);
        return text.charAt(0).toUpperCase() + text.slice(1);
      }
    }
  }
  return new Date(time).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toSummary(raw: SessionLibraryEntry): SessionLibrarySummary {
  const { payload: _payload, ...summary } = raw;
  return summary;
}

function isEntry(raw: unknown): raw is SessionLibraryEntry {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const entry = raw as Partial<SessionLibraryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.updatedAt === "number" &&
    typeof entry.payload === "string"
  );
}

function normalizeEntry(raw: SessionLibraryEntry): SessionLibraryEntry {
  return {
    id: raw.id,
    name: raw.name,
    createdAt:
      typeof raw.createdAt === "number" ? raw.createdAt : raw.updatedAt,
    updatedAt: raw.updatedAt,
    clipCount: typeof raw.clipCount === "number" ? raw.clipCount : 0,
    payload: raw.payload,
  };
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Session library request failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Session library write aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Session library write failed"));
  });
}

export function createSessionLibraryStore(
  factory?: IDBFactory,
): SessionLibraryStore {
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
          if (!database.objectStoreNames.contains(ENTRIES_STORE)) {
            database.createObjectStore(ENTRIES_STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error("Failed to open session library"));
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  };

  return {
    async list() {
      const database = await openDatabase();
      const transaction = database.transaction(ENTRIES_STORE, "readonly");
      const raw = await requestResult(
        transaction.objectStore(ENTRIES_STORE).getAll(),
      );
      return sortSessionLibrary(
        raw.filter(isEntry).map((entry) => toSummary(normalizeEntry(entry))),
      );
    },

    async get(id) {
      const database = await openDatabase();
      const transaction = database.transaction(ENTRIES_STORE, "readonly");
      const raw: unknown = await requestResult(
        transaction.objectStore(ENTRIES_STORE).get(id),
      );
      return isEntry(raw) ? normalizeEntry(raw) : null;
    },

    async put(entry) {
      const database = await openDatabase();
      const transaction = database.transaction(ENTRIES_STORE, "readwrite");
      transaction.objectStore(ENTRIES_STORE).put(entry);
      await transactionDone(transaction);
    },

    async update(id, patch) {
      const database = await openDatabase();
      const transaction = database.transaction(ENTRIES_STORE, "readwrite");
      const store = transaction.objectStore(ENTRIES_STORE);
      const raw: unknown = await requestResult(store.get(id));
      if (!isEntry(raw)) {
        await transactionDone(transaction);
        return false;
      }
      store.put({ ...normalizeEntry(raw), ...patch, id });
      await transactionDone(transaction);
      return true;
    },

    async delete(id) {
      const database = await openDatabase();
      const transaction = database.transaction(ENTRIES_STORE, "readwrite");
      transaction.objectStore(ENTRIES_STORE).delete(id);
      await transactionDone(transaction);
    },

    close() {
      const pending = dbPromise;
      dbPromise = null;
      void pending?.then((database) => database.close()).catch(() => {});
    },
  };
}

let defaultStore: SessionLibraryStore | null = null;

export function getSessionLibraryStore() {
  defaultStore ??= createSessionLibraryStore();
  return defaultStore;
}
