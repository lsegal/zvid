// Writes cached media into OPFS with sync access handles, which browsers only
// expose in dedicated workers. Used where the main thread has no
// `createWritable`.

import {
  type OpfsSyncDirectoryHandle,
  writeWithSyncAccessHandle,
} from "./opfs-sync-write";

export type OpfsMediaWorkerRequest =
  | { id: number; type: "probe" }
  | { id: number; type: "write"; directory: string; name: string; blob: Blob };

export type OpfsMediaWorkerResponse =
  | { id: number; ok: true; supported?: boolean }
  | { id: number; ok: false; error: string; errorName: string };

// Sync access handles are exclusive per file, so writes run one at a time.
let queue: Promise<unknown> = Promise.resolve();

async function getDirectory(name: string) {
  const root = await navigator.storage.getDirectory();
  return (await root.getDirectoryHandle(name, {
    create: true,
  })) as unknown as OpfsSyncDirectoryHandle;
}

async function probe() {
  if (
    typeof navigator.storage?.getDirectory !== "function" ||
    typeof FileSystemFileHandle === "undefined" ||
    typeof (FileSystemFileHandle.prototype as { createSyncAccessHandle?: unknown })
      .createSyncAccessHandle !== "function"
  ) {
    return false;
  }
  await navigator.storage.getDirectory();
  return true;
}

async function handle(request: OpfsMediaWorkerRequest) {
  if (request.type === "probe") {
    return { supported: await probe() };
  }
  const directory = await getDirectory(request.directory);
  await writeWithSyncAccessHandle(directory, request.name, request.blob);
  return {};
}

self.onmessage = (event: MessageEvent<OpfsMediaWorkerRequest>) => {
  const request = event.data;
  const run = queue.then(() => handle(request));
  queue = run.catch(() => undefined);
  run.then(
    (result) => {
      self.postMessage({
        id: request.id,
        ok: true,
        ...result,
      } satisfies OpfsMediaWorkerResponse);
    },
    (error: unknown) => {
      self.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        errorName:
          error && typeof error === "object" && "name" in error
            ? String(error.name)
            : "Error",
      } satisfies OpfsMediaWorkerResponse);
    },
  );
};
