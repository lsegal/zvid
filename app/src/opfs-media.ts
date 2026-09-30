// Media files in the Origin Private File System, one file per media id under
// `media/`. Files are streamed in and read back as `File`s, so large videos
// never have to be held in memory as a single IndexedDB value. Browsers
// without main-thread `createWritable` stream them in from a worker with sync
// access handles instead.

import type { MediaBlobBackend } from "./media-store.ts";
import type {
  OpfsMediaWorkerRequest,
  OpfsMediaWorkerResponse,
} from "./opfs-media.worker.ts";

export type OpfsWritable = WritableStream<Uint8Array> & {
  abort(reason?: unknown): Promise<void>;
};

export type OpfsFileHandle = {
  getFile(): Promise<File>;
  createWritable(): Promise<OpfsWritable>;
};

export type OpfsDirectoryHandle = {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
};

export const OPFS_MEDIA_DIRECTORY = "media";

function isNotFoundError(error: unknown) {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "NotFoundError"
  );
}

// Media ids can contain characters that aren't valid in file names.
export function opfsMediaFileName(id: string) {
  return encodeURIComponent(id);
}

// Writes a blob into the named file of the OPFS media directory.
export type OpfsMediaWriter = (
  media: OpfsDirectoryHandle,
  name: string,
  blob: Blob,
) => Promise<void>;

// The writable goes to a swap file that replaces the old contents only when
// the stream closes, so a failed write leaves any old file intact.
export const writeWithWritable: OpfsMediaWriter = async (media, name, blob) => {
  const handle = await media.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await blob.stream().pipeTo(writable);
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
};

export function createOpfsMediaBackend(
  root: OpfsDirectoryHandle,
  writeFile: OpfsMediaWriter = writeWithWritable,
): MediaBlobBackend {
  let directory: Promise<OpfsDirectoryHandle> | null = null;
  const getDirectory = () => {
    directory ??= root
      .getDirectoryHandle(OPFS_MEDIA_DIRECTORY, { create: true })
      .catch((error) => {
        directory = null;
        throw error;
      });
    return directory;
  };

  return {
    kind: "opfs",
    async read(id) {
      const media = await getDirectory();
      try {
        const handle = await media.getFileHandle(opfsMediaFileName(id));
        return await handle.getFile();
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },
    async write(id, blob) {
      await writeFile(await getDirectory(), opfsMediaFileName(id), blob);
    },
    async remove(id) {
      const media = await getDirectory();
      try {
        await media.removeEntry(opfsMediaFileName(id));
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    },
  };
}

export type OpfsMediaWriteMode = "writable" | "sync-worker";

export type OpfsMediaSupport = {
  // `navigator.storage.getDirectory` exists.
  directory: boolean;
  // `FileSystemFileHandle.createWritable` exists on the main thread.
  writable: boolean;
  // Resolves whether a worker can write with sync access handles. Only asked
  // when the main thread can't write.
  syncAccessWorker: () => Promise<boolean>;
};

// Picks how media is written into OPFS, or null to fall back to IndexedDB.
export async function selectOpfsMediaWriteMode(
  support: OpfsMediaSupport,
): Promise<OpfsMediaWriteMode | null> {
  if (!support.directory) {
    return null;
  }
  if (support.writable) {
    return "writable";
  }
  try {
    return (await support.syncAccessWorker()) ? "sync-worker" : null;
  } catch {
    return null;
  }
}

export type OpfsMediaWorkerPort = {
  postMessage(message: OpfsMediaWorkerRequest): void;
  onmessage: ((event: MessageEvent<OpfsMediaWorkerResponse>) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
};

type OpfsMediaWorkerSuccess = Extract<OpfsMediaWorkerResponse, { ok: true }>;

// Sends requests to the OPFS media worker. Failures are rethrown with the
// worker's error name, so quota errors are still recognized.
export function createOpfsMediaWorkerClient(port: OpfsMediaWorkerPort) {
  const pending = new Map<
    number,
    {
      resolve: (response: OpfsMediaWorkerSuccess) => void;
      reject: (error: Error) => void;
    }
  >();
  let nextId = 1;

  const failAll = (error: Error) => {
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  };

  port.onmessage = (event) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) {
      return;
    }
    pending.delete(response.id);
    if (response.ok) {
      request.resolve(response);
    } else {
      request.reject(
        Object.assign(new Error(response.error), { name: response.errorName }),
      );
    }
  };
  port.onerror = () => failAll(new Error("OPFS media worker failed"));

  const send = (
    message:
      | { type: "probe" }
      | { type: "write"; directory: string; name: string; blob: Blob },
  ) =>
    new Promise<OpfsMediaWorkerSuccess>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      port.postMessage({ ...message, id });
    });

  return {
    probe: async () => (await send({ type: "probe" })).supported === true,
    write: async (name: string, blob: Blob) => {
      await send({
        type: "write",
        directory: OPFS_MEDIA_DIRECTORY,
        name,
        blob,
      });
    },
    terminate: () => {
      failAll(new Error("OPFS media worker stopped"));
      port.terminate();
    },
  };
}

export type OpfsMediaWorkerClient = ReturnType<
  typeof createOpfsMediaWorkerClient
>;

// Writes through the worker, which resolves the media directory itself.
export function writeWithWorker(
  worker: OpfsMediaWorkerClient,
): OpfsMediaWriter {
  return (_media, name, blob) => worker.write(name, blob);
}

function startOpfsMediaWorker(): OpfsMediaWorkerClient | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  try {
    const worker = new Worker(
      new URL("./opfs-media.worker.ts", import.meta.url),
      { type: "module" },
    );
    return createOpfsMediaWorkerClient(
      worker as unknown as OpfsMediaWorkerPort,
    );
  } catch {
    return null;
  }
}

// Returns an OPFS backend when the browser can stream files into OPFS, from
// the main thread or through a sync-access-handle worker, or null so callers
// fall back to IndexedDB.
export async function openOpfsMediaBackend(): Promise<MediaBlobBackend | null> {
  const started: { worker: OpfsMediaWorkerClient | null } = { worker: null };
  const mode = await selectOpfsMediaWriteMode({
    directory:
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.getDirectory === "function",
    writable:
      typeof FileSystemFileHandle !== "undefined" &&
      typeof FileSystemFileHandle.prototype.createWritable === "function",
    syncAccessWorker: async () => {
      started.worker = startOpfsMediaWorker();
      return (await started.worker?.probe()) ?? false;
    },
  });
  const syncWorker = mode === "sync-worker" ? started.worker : null;
  if (!syncWorker) {
    started.worker?.terminate();
  }
  if (!mode) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    return createOpfsMediaBackend(
      root as unknown as OpfsDirectoryHandle,
      syncWorker ? writeWithWorker(syncWorker) : writeWithWritable,
    );
  } catch {
    syncWorker?.terminate();
    return null;
  }
}
