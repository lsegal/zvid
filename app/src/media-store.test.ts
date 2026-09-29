import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMediaStore,
  type MediaBlobBackend,
  type MediaIndex,
  type MediaIndexRecord,
} from "./media-store.ts";
import {
  createOpfsMediaBackend,
  type OpfsDirectoryHandle,
  type OpfsFileHandle,
  type OpfsWritable,
} from "./opfs-media.ts";
import {
  QUOTA_HEADROOM_BYTES,
  type StorageEstimate,
} from "./storage-manager.ts";

function notFound() {
  return Object.assign(new Error("missing"), { name: "NotFoundError" });
}

// An in-memory stand-in for the OPFS directory API.
function createFakeDirectory(): OpfsDirectoryHandle & {
  files: Map<string, Blob>;
  directories: Map<string, OpfsDirectoryHandle & { files: Map<string, Blob> }>;
} {
  const files = new Map<string, Blob>();
  const directories = new Map();
  const directory = {
    files,
    directories,
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      let child = directories.get(name);
      if (!child) {
        if (!options?.create) {
          throw notFound();
        }
        child = createFakeDirectory();
        directories.set(name, child);
      }
      return child;
    },
    async getFileHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<OpfsFileHandle> {
      if (!files.has(name) && !options?.create) {
        throw notFound();
      }
      return {
        async getFile() {
          const blob = files.get(name);
          if (!blob) {
            throw notFound();
          }
          return new File([blob], name, { type: blob.type });
        },
        async createWritable() {
          const chunks: Uint8Array<ArrayBuffer>[] = [];
          const stream = new WritableStream<Uint8Array<ArrayBuffer>>({
            write(chunk) {
              chunks.push(chunk);
            },
            close() {
              files.set(name, new Blob(chunks));
            },
          });
          return stream as OpfsWritable;
        },
      };
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) {
        throw notFound();
      }
    },
  };
  return directory;
}

function createMemoryBackend(
  kind: MediaBlobBackend["kind"],
  options: { failWrites?: () => unknown } = {},
) {
  const blobs = new Map<string, Blob>();
  const backend: MediaBlobBackend = {
    kind,
    read: async (id) => blobs.get(id) ?? null,
    write: async (id, blob) => {
      const failure = options.failWrites?.();
      if (failure) {
        throw failure;
      }
      blobs.set(id, blob);
    },
    remove: async (id) => {
      blobs.delete(id);
    },
    listIds: async () => [...blobs.keys()],
  };
  return { backend, blobs };
}

function createMemoryIndex() {
  const records = new Map<string, MediaIndexRecord>();
  const index: MediaIndex = {
    list: async () => [...records.values()].map((entry) => ({ ...entry })),
    get: async (id) => {
      const entry = records.get(id);
      return entry ? { ...entry } : null;
    },
    put: async (entry) => {
      records.set(entry.id, { ...entry });
    },
    remove: async (ids) => {
      for (const id of ids) {
        records.delete(id);
      }
    },
  };
  return { index, records };
}

function setup({
  withOpfs = true,
  estimate = null as StorageEstimate | null,
  failIdbWrites,
}: {
  withOpfs?: boolean;
  estimate?: StorageEstimate | null;
  failIdbWrites?: () => unknown;
} = {}) {
  const root = createFakeDirectory();
  const opfs = withOpfs ? createOpfsMediaBackend(root) : null;
  const idb = createMemoryBackend("idb", { failWrites: failIdbWrites });
  const { index, records } = createMemoryIndex();
  let time = 1000;
  let writes = 0;
  const store = createMediaStore({
    index,
    idb: idb.backend,
    opfs: async () => opfs,
    estimate: async () => estimate,
    onWrite: () => {
      writes += 1;
    },
    now: () => time++,
  });
  return {
    store,
    root,
    idbBlobs: idb.blobs,
    records,
    opfsFiles: () => root.directories.get("media")?.files ?? new Map(),
    persistenceRequests: () => writes,
  };
}

function blobOf(text: string) {
  return new Blob([text], { type: "video/mp4" });
}

describe("media store with OPFS", () => {
  it("round-trips media through OPFS files", async () => {
    const test = setup();
    assert.deepEqual(await test.store.put("clip/1", blobOf("hello")), {
      status: "cached",
    });

    assert.deepEqual([...test.opfsFiles().keys()], ["clip%2F1"]);
    assert.equal(test.idbBlobs.size, 0);
    assert.equal(test.records.get("clip/1")?.backend, "opfs");
    assert.equal(test.records.get("clip/1")?.size, 5);

    const cached = await test.store.get("clip/1");
    assert.ok(cached instanceof File);
    assert.equal(await cached.text(), "hello");
    assert.equal(await test.store.get("missing"), null);
  });

  it("asks for persistent storage when media is cached", async () => {
    const test = setup();
    assert.equal(test.persistenceRequests(), 0);
    await test.store.put("a", blobOf("a"));
    assert.equal(test.persistenceRequests(), 1);
  });

  it("doesn't rewrite the file it just handed out", async () => {
    const test = setup();
    await test.store.put("a", blobOf("a"));
    const cached = await test.store.get("a");
    assert.ok(cached);
    const before = test.opfsFiles().get("a");
    await test.store.put("a", cached);
    assert.equal(test.opfsFiles().get("a"), before);
  });

  it("moves blobs cached in IndexedDB into OPFS and cleans up", async () => {
    const test = setup();
    test.idbBlobs.set("legacy", blobOf("old bytes"));

    assert.equal(await test.store.migrate(), 1);

    assert.equal(test.idbBlobs.size, 0);
    assert.equal(test.records.get("legacy")?.backend, "opfs");
    assert.equal(test.records.get("legacy")?.lastUsedAt, 0);
    assert.equal(await (await test.store.get("legacy"))?.text(), "old bytes");
  });

  it("reads legacy IndexedDB media before migration runs", async () => {
    const test = setup();
    test.idbBlobs.set("legacy", blobOf("old bytes"));
    assert.equal(await (await test.store.get("legacy"))?.text(), "old bytes");
    assert.equal(test.records.get("legacy")?.backend, "idb");
  });

  it("reports removed files that were handed out", async () => {
    const test = setup();
    await test.store.put("a", blobOf("a"));
    await test.store.put("b", blobOf("b"));
    await test.store.get("a");

    assert.deepEqual(await test.store.remove(["a", "b"]), ["a"]);
    assert.equal(test.opfsFiles().size, 0);
    assert.equal(test.records.size, 0);
  });
});

describe("media store without OPFS", () => {
  it("falls back to the IndexedDB blob store", async () => {
    const test = setup({ withOpfs: false });
    assert.deepEqual(await test.store.put("a", blobOf("abc")), {
      status: "cached",
    });
    assert.equal(test.idbBlobs.size, 1);
    assert.equal(test.records.get("a")?.backend, "idb");
    assert.equal(await (await test.store.get("a"))?.text(), "abc");
    assert.equal(await test.store.backend(), "idb");
  });

  it("indexes legacy media without moving it", async () => {
    const test = setup({ withOpfs: false });
    test.idbBlobs.set("legacy", blobOf("old"));
    assert.equal(await test.store.migrate(), 0);
    assert.equal(test.idbBlobs.size, 1);
    assert.deepEqual(test.records.get("legacy"), {
      id: "legacy",
      size: 3,
      lastUsedAt: 0,
      sessions: [],
      backend: "idb",
    });
  });
});

describe("media store quota handling", () => {
  it("evicts unreferenced least recently used media first", async () => {
    const estimate = { usage: 0, quota: Number.MAX_SAFE_INTEGER };
    const test = setup({ estimate });
    // "current" is the least recently cached but the open session uses it.
    await test.store.put("current", blobOf("x".repeat(10)));
    await test.store.put("old", blobOf("x".repeat(10)));
    await test.store.put("newer", blobOf("x".repeat(10)));
    await test.store.setSession("Now", ["current"]);
    test.records.set("current", {
      ...(test.records.get("current") as MediaIndexRecord),
      lastUsedAt: 0,
    });

    // Room for 5 of the 10 bytes needed.
    estimate.usage = 30;
    estimate.quota = QUOTA_HEADROOM_BYTES + 35;

    assert.deepEqual(await test.store.put("incoming", blobOf("x".repeat(10))), {
      status: "cached",
    });
    assert.deepEqual([...test.records.keys()].sort(), [
      "current",
      "incoming",
      "newer",
    ]);
    assert.equal(test.opfsFiles().has("old"), false);
  });

  it("skips caching instead of throwing when storage is full", async () => {
    const test = setup({
      withOpfs: false,
      failIdbWrites: () =>
        Object.assign(new Error("full"), { name: "QuotaExceededError" }),
    });
    assert.deepEqual(await test.store.put("a", blobOf("abc")), {
      status: "skipped",
      reason: "quota",
    });
    assert.equal(test.records.size, 0);
  });

  it("records the sessions that use each file", async () => {
    const test = setup();
    await test.store.setSession("One", ["a"]);
    await test.store.put("a", blobOf("a"));
    await test.store.setSession("Two", ["a"]);
    await test.store.setSession("One", ["a"]);
    assert.deepEqual(test.records.get("a")?.sessions, ["Two", "One"]);
  });
});
