const DB_NAME = 'zvid-media-cache'
const STORE_NAME = 'media'
const DB_VERSION = 1

type CachedMediaEntry = {
  id: string
  blob: Blob
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)
      request.onerror = () => reject(request.error ?? new Error('Failed to open media cache'))
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
    })
  }

  return dbPromise
}

function runStoreRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void,
) {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode)
        const store = transaction.objectStore(STORE_NAME)
        operation(store, resolve, reject)
        transaction.onerror = () =>
          reject(transaction.error ?? new Error(`Media cache ${mode} transaction failed`))
      }),
  )
}

export function getCachedMediaBlob(id: string) {
  return runStoreRequest<Blob | null>('readonly', (store, resolve, reject) => {
    const request = store.get(id)
    request.onerror = () => reject(request.error ?? new Error(`Failed to read cached media ${id}`))
    request.onsuccess = () => {
      const entry = request.result as CachedMediaEntry | undefined
      resolve(entry?.blob ?? null)
    }
  })
}

export function cacheMediaBlob(id: string, blob: Blob) {
  return runStoreRequest<void>('readwrite', (store, resolve, reject) => {
    const request = store.put({
      id,
      blob,
      updatedAt: Date.now(),
    } satisfies CachedMediaEntry)
    request.onerror = () => reject(request.error ?? new Error(`Failed to cache media ${id}`))
    request.onsuccess = () => resolve()
  })
}
