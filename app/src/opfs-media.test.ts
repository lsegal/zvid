import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMediaStore, type MediaIndexRecord } from "./media-store.ts";
import {
  createOpfsMediaBackend,
  createOpfsMediaWorkerClient,
  type OpfsDirectoryHandle,
  type OpfsMediaSupport,
  type OpfsMediaWorkerPort,
  selectOpfsMediaWriteMode,
  writeWithWorker,
} from "./opfs-media.ts";
import type {
  OpfsMediaWorkerRequest,
  OpfsMediaWorkerResponse,
} from "./opfs-media.worker.ts";
import {
  type OpfsSyncAccessHandle,
  type OpfsSyncDirectoryHandle,
  writeWithSyncAccessHandle,
} from "./opfs-sync-write.ts";
import { isQuotaExceededError } from "./storage-manager.ts";

function notFound() {
  return Object.assign(new Error("missing"), { name: "NotFoundError" });
}

// An in-memory OPFS directory whose files can only be written with sync
// access handles, as in a browser without main-thread `createWritable`.
function createSyncDirectory(
  options: { failAt?: number; asyncMethods?: boolean } = {},
) {
  const files = new Map<string, Uint8Array>();
  const wrap = <T>(value: T) =>
    options.asyncMethods ? Promise.resolve(value) : value;
  const directory: OpfsSyncDirectoryHandle & OpfsDirectoryHandle = {
    async getDirectoryHandle() {
      return directory;
    },
    async getFileHandle(name: string, handleOptions?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!handleOptions?.create) {
          throw notFound();
        }
        files.set(name, new Uint8Array());
      }
      return {
        async getFile() {
          const bytes = files.get(name);
          if (!bytes) {
            throw notFound();
          }
          return new File([bytes.slice()], name);
        },
        async createWritable(): Promise<never> {
          throw new TypeError("createWritable is not a function");
        },
        async createSyncAccessHandle(): Promise<OpfsSyncAccessHandle> {
          let open = true;
          return {
            write(buffer, { at }) {
              assert.ok(open);
              if (options.failAt !== undefined && at >= options.failAt) {
                throw Object.assign(new Error("full"), {
                  name: "QuotaExceededError",
                });
              }
              const current = files.get(name) ?? new Uint8Array();
              const next = new Uint8Array(
                Math.max(current.byteLength, at + buffer.byteLength),
              );
              next.set(current);
              next.set(buffer, at);
              files.set(name, next);
              return wrap(buffer.byteLength);
            },
            truncate(size) {
              files.set(
                name,
                (files.get(name) ?? new Uint8Array()).slice(0, size),
              );
              return wrap(undefined);
            },
            flush: () => wrap(undefined),
            close() {
              open = false;
              return wrap(undefined);
            },
          };
        },
      };
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) {
        throw notFound();
      }
    },
  };
  return { directory, files };
}

// A stand-in for the OPFS media worker that runs its writes in-process.
function createFakeWorker(
  directory: OpfsSyncDirectoryHandle,
  supported = true,
) {
  let terminated = false;
  const port: OpfsMediaWorkerPort = {
    onmessage: null,
    onerror: null,
    postMessage(request: OpfsMediaWorkerRequest) {
      const reply = (response: OpfsMediaWorkerResponse) =>
        port.onmessage?.({ data: response } as MessageEvent);
      const run =
        request.type === "probe"
          ? Promise.resolve({ supported })
          : writeWithSyncAccessHandle(
              directory,
              request.name,
              request.blob,
            ).then(() => ({}));
      run.then(
        (result) => reply({ id: request.id, ok: true, ...result }),
        (error: Error) =>
          reply({
            id: request.id,
            ok: false,
            error: error.message,
            errorName: error.name,
          }),
      );
    },
    terminate() {
      terminated = true;
    },
  };
  return { port, terminated: () => terminated };
}

function support(overrides: Partial<OpfsMediaSupport> = {}): OpfsMediaSupport {
  return {
    directory: true,
    writable: true,
    syncAccessWorker: async () => true,
    ...overrides,
  };
}

describe("OPFS media backend selection", () => {
  it("writes from the main thread when createWritable is available", async () => {
    let probed = false;
    const mode = await selectOpfsMediaWriteMode(
      support({
        syncAccessWorker: async () => {
          probed = true;
          return true;
        },
      }),
    );
    assert.equal(mode, "writable");
    assert.equal(probed, false);
  });

  it("uses the sync access handle worker without createWritable", async () => {
    assert.equal(
      await selectOpfsMediaWriteMode(support({ writable: false })),
      "sync-worker",
    );
  });

  it("falls back to IndexedDB when neither is available", async () => {
    assert.equal(
      await selectOpfsMediaWriteMode(
        support({ writable: false, syncAccessWorker: async () => false }),
      ),
      null,
    );
    assert.equal(
      await selectOpfsMediaWriteMode(
        support({
          writable: false,
          syncAccessWorker: () => Promise.reject(new Error("no worker")),
        }),
      ),
      null,
    );
  });

  it("falls back to IndexedDB without OPFS", async () => {
    assert.equal(
      await selectOpfsMediaWriteMode(support({ directory: false })),
      null,
    );
  });
});

describe("sync access handle writes", () => {
  for (const asyncMethods of [false, true]) {
    it(`streams the blob into the file (${asyncMethods ? "async" : "sync"} handle methods)`, async () => {
      const { directory, files } = createSyncDirectory({ asyncMethods });
      files.set("a", new TextEncoder().encode("a much longer old file"));
      await writeWithSyncAccessHandle(directory, "a", new Blob(["new"]));
      assert.equal(new TextDecoder().decode(files.get("a")), "new");
    });
  }

  it("removes the partial file when a write fails", async () => {
    const { directory, files } = createSyncDirectory({ failAt: 0 });
    await assert.rejects(
      writeWithSyncAccessHandle(directory, "a", new Blob(["abc"])),
      (error) => isQuotaExceededError(error),
    );
    assert.equal(files.has("a"), false);
  });
});

describe("OPFS media through the sync access handle worker", () => {
  function setup(options: { failAt?: number } = {}) {
    const { directory, files } = createSyncDirectory(options);
    const worker = createFakeWorker(directory);
    const client = createOpfsMediaWorkerClient(worker.port);
    const opfs = createOpfsMediaBackend(directory, writeWithWorker(client));
    const idbBlobs = new Map<string, Blob>();
    const records = new Map<string, MediaIndexRecord>();
    const store = createMediaStore({
      index: {
        list: async () => [...records.values()],
        get: async (id) => records.get(id) ?? null,
        put: async (record) => {
          records.set(record.id, { ...record });
        },
        remove: async (ids) => {
          for (const id of ids) {
            records.delete(id);
          }
        },
      },
      idb: {
        kind: "idb",
        read: async (id) => idbBlobs.get(id) ?? null,
        write: async (id, blob) => {
          idbBlobs.set(id, blob);
        },
        remove: async (id) => {
          idbBlobs.delete(id);
        },
        listIds: async () => [...idbBlobs.keys()],
      },
      opfs: async () => opfs,
      estimate: async () => null,
    });
    return { client, files, idbBlobs, records, store };
  }

  it("probes the worker for sync access handle support", async () => {
    const { directory } = createSyncDirectory();
    const supported = createOpfsMediaWorkerClient(
      createFakeWorker(directory, true).port,
    );
    const unsupported = createOpfsMediaWorkerClient(
      createFakeWorker(directory, false).port,
    );
    assert.equal(await supported.probe(), true);
    assert.equal(await unsupported.probe(), false);
  });

  it("caches new media in OPFS", async () => {
    const test = setup();
    assert.deepEqual(await test.store.put("clip/1", new Blob(["hello"])), {
      status: "cached",
    });
    assert.equal(test.records.get("clip/1")?.backend, "opfs");
    assert.equal(test.idbBlobs.size, 0);
    assert.equal(new TextDecoder().decode(test.files.get("clip%2F1")), "hello");
    assert.equal(await (await test.store.get("clip/1"))?.text(), "hello");
    assert.equal(await test.store.backend(), "opfs");
  });

  it("migrates IndexedDB media into OPFS", async () => {
    const test = setup();
    test.idbBlobs.set("legacy", new Blob(["old bytes"]));
    assert.equal(await test.store.migrate(), 1);
    assert.equal(test.idbBlobs.size, 0);
    assert.equal(test.records.get("legacy")?.backend, "opfs");
    assert.equal(await (await test.store.get("legacy"))?.text(), "old bytes");
  });

  it("keeps the quota error name from the worker", async () => {
    const test = setup({ failAt: 0 });
    await assert.rejects(test.client.write("a", new Blob(["abc"])), (error) =>
      isQuotaExceededError(error),
    );
    assert.deepEqual(await test.store.put("a", new Blob(["abc"])), {
      status: "skipped",
      reason: "quota",
    });
  });

  it("fails pending writes when the worker stops", async () => {
    let terminated = false;
    const client = createOpfsMediaWorkerClient({
      onmessage: null,
      onerror: null,
      postMessage() {},
      terminate() {
        terminated = true;
      },
    });
    const write = client.write("a", new Blob(["abc"]));
    client.terminate();
    await assert.rejects(write, /stopped/);
    assert.equal(terminated, true);
  });
});
