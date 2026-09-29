import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CachedMediaRecord,
  estimateStorage,
  formatBytes,
  getPersistence,
  isQuotaExceededError,
  planEviction,
  QUOTA_HEADROOM_BYTES,
  requestPersistence,
  type StorageLike,
  summarizeSessionUsage,
  writeWithinQuota,
} from "./storage-manager.ts";

const MB = 1024 * 1024;

function quotaError() {
  return Object.assign(new Error("full"), { name: "QuotaExceededError" });
}

function record(
  id: string,
  size: number,
  lastUsedAt: number,
  sessions: string[] = [],
): CachedMediaRecord {
  return { id, size, lastUsedAt, sessions };
}

describe("requestPersistence", () => {
  it("asks for persistence when the origin isn't persistent yet", async () => {
    let asked = 0;
    const storage: StorageLike = {
      persisted: async () => false,
      persist: async () => {
        asked += 1;
        return true;
      },
    };
    assert.equal(await requestPersistence(storage), "persistent");
    assert.equal(asked, 1);
  });

  it("doesn't ask again once storage is persistent", async () => {
    const storage: StorageLike = {
      persisted: async () => true,
      persist: async () => assert.fail("should not prompt"),
    };
    assert.equal(await requestPersistence(storage), "persistent");
  });

  it("reports best-effort storage when the browser declines", async () => {
    const storage: StorageLike = {
      persisted: async () => false,
      persist: async () => false,
    };
    assert.equal(await requestPersistence(storage), "best-effort");
  });

  it("reports unsupported without the storage API", async () => {
    assert.equal(await requestPersistence({}), "unsupported");
    assert.equal(await requestPersistence(undefined), "unsupported");
  });

  it("reads the state without prompting", async () => {
    const storage: StorageLike = {
      persisted: async () => false,
      persist: async () => assert.fail("should not prompt"),
    };
    assert.equal(await getPersistence(storage), "best-effort");
  });
});

describe("estimateStorage", () => {
  it("returns usage and quota", async () => {
    assert.deepEqual(
      await estimateStorage({
        estimate: async () => ({ usage: 5, quota: 10 }),
      }),
      { usage: 5, quota: 10 },
    );
  });

  it("returns null when the estimate is unavailable", async () => {
    assert.equal(await estimateStorage({}), null);
    assert.equal(
      await estimateStorage({ estimate: async () => ({ usage: 5 }) }),
      null,
    );
    assert.equal(
      await estimateStorage({
        estimate: async () => {
          throw new Error("nope");
        },
      }),
      null,
    );
  });
});

describe("isQuotaExceededError", () => {
  it("recognizes quota errors across browsers", () => {
    assert.equal(isQuotaExceededError(quotaError()), true);
    assert.equal(
      isQuotaExceededError({ name: "NS_ERROR_DOM_QUOTA_REACHED" }),
      true,
    );
    assert.equal(isQuotaExceededError({ name: "Error", code: 22 }), true);
    assert.equal(isQuotaExceededError(new Error("other")), false);
    assert.equal(isQuotaExceededError(null), false);
  });
});

describe("planEviction", () => {
  const records = [
    record("recent", 30, 300),
    record("oldest", 10, 100),
    record("referenced", 100, 50),
    record("older", 20, 200),
  ];

  it("evicts nothing when the file fits", () => {
    assert.deepEqual(planEviction(records, 10, 10, new Set()), []);
  });

  it("evicts unreferenced files, least recently used first", () => {
    assert.deepEqual(planEviction(records, 40, 15, new Set(["referenced"])), [
      "oldest",
      "older",
    ]);
  });

  it("never evicts referenced files or the file being written", () => {
    assert.deepEqual(
      planEviction(records, 65, 15, new Set(["referenced"]), "oldest"),
      ["older", "recent"],
    );
  });

  it("returns null when evicting everything eligible isn't enough", () => {
    assert.equal(planEviction(records, 100, 0, new Set(["referenced"])), null);
  });
});

describe("writeWithinQuota", () => {
  function setup({
    usage,
    quota,
    records,
    failures = [] as unknown[],
  }: {
    usage: number;
    quota: number;
    records: CachedMediaRecord[];
    failures?: unknown[];
  }) {
    const evicted: string[] = [];
    let writes = 0;
    return {
      evicted,
      writes: () => writes,
      options: {
        estimate: async () => ({ usage, quota }),
        listRecords: async () =>
          records.filter((entry) => !evicted.includes(entry.id)),
        evict: async (ids: string[]) => {
          evicted.push(...ids);
        },
        write: async () => {
          writes += 1;
          const failure = failures.shift();
          if (failure) {
            throw failure;
          }
        },
      },
    };
  }

  it("writes without evicting when there's room", async () => {
    const test = setup({
      usage: 0,
      quota: 1000 * MB,
      records: [record("old", 50 * MB, 1)],
    });
    const result = await writeWithinQuota({
      id: "new",
      size: 100 * MB,
      referencedIds: new Set(),
      ...test.options,
    });
    assert.deepEqual(result, { status: "cached" });
    assert.deepEqual(test.evicted, []);
  });

  it("evicts unreferenced least recently used media to make room", async () => {
    const test = setup({
      usage: 180 * MB,
      quota: 200 * MB + QUOTA_HEADROOM_BYTES,
      records: [
        record("current", 100 * MB, 1),
        record("stale", 50 * MB, 2),
        record("recent", 30 * MB, 3),
      ],
    });
    const result = await writeWithinQuota({
      id: "new",
      size: 60 * MB,
      referencedIds: new Set(["current"]),
      ...test.options,
    });
    assert.deepEqual(result, { status: "cached" });
    assert.deepEqual(test.evicted, ["stale"]);
    assert.equal(test.writes(), 1);
  });

  it("skips the file without throwing when nothing can make room", async () => {
    const test = setup({
      usage: 180 * MB,
      quota: 200 * MB,
      records: [record("current", 180 * MB, 1)],
    });
    const result = await writeWithinQuota({
      id: "new",
      size: 60 * MB,
      referencedIds: new Set(["current"]),
      ...test.options,
    });
    assert.deepEqual(result, { status: "skipped", reason: "quota" });
    assert.deepEqual(test.evicted, []);
    assert.equal(test.writes(), 0);
  });

  it("counts the bytes of the entry being replaced as free", async () => {
    const test = setup({
      usage: 100 * MB,
      quota: 100 * MB + QUOTA_HEADROOM_BYTES,
      records: [record("same", 100 * MB, 1)],
    });
    const result = await writeWithinQuota({
      id: "same",
      size: 90 * MB,
      referencedIds: new Set(["same"]),
      ...test.options,
    });
    assert.deepEqual(result, { status: "cached" });
  });

  it("evicts and retries once after a QuotaExceededError", async () => {
    const test = setup({
      usage: 0,
      quota: 1000 * MB,
      records: [record("stale", 50 * MB, 1)],
      failures: [quotaError()],
    });
    const result = await writeWithinQuota({
      id: "new",
      size: 40 * MB,
      referencedIds: new Set(),
      ...test.options,
    });
    assert.deepEqual(result, { status: "cached" });
    assert.deepEqual(test.evicted, ["stale"]);
    assert.equal(test.writes(), 2);
  });

  it("skips after a QuotaExceededError when nothing can be evicted", async () => {
    const test = setup({
      usage: 0,
      quota: 1000 * MB,
      records: [record("current", 50 * MB, 1)],
      failures: [quotaError()],
    });
    const result = await writeWithinQuota({
      id: "new",
      size: 40 * MB,
      referencedIds: new Set(["current"]),
      ...test.options,
    });
    assert.deepEqual(result, { status: "skipped", reason: "quota" });
    assert.equal(test.writes(), 1);
  });

  it("skips when the retry also runs out of quota", async () => {
    const test = setup({
      usage: 0,
      quota: 1000 * MB,
      records: [record("stale", 50 * MB, 1)],
      failures: [quotaError(), quotaError()],
    });
    const result = await writeWithinQuota({
      id: "new",
      size: 40 * MB,
      referencedIds: new Set(),
      ...test.options,
    });
    assert.deepEqual(result, { status: "skipped", reason: "quota" });
  });

  it("rethrows errors that aren't about quota", async () => {
    const test = setup({
      usage: 0,
      quota: 1000 * MB,
      records: [],
      failures: [new Error("disk on fire")],
    });
    await assert.rejects(
      writeWithinQuota({
        id: "new",
        size: 1,
        referencedIds: new Set(),
        ...test.options,
      }),
      /disk on fire/,
    );
  });

  it("writes directly when no estimate is available", async () => {
    const test = setup({ usage: 0, quota: 0, records: [] });
    const result = await writeWithinQuota({
      id: "new",
      size: 1,
      referencedIds: new Set(),
      ...test.options,
      estimate: async () => null,
    });
    assert.deepEqual(result, { status: "cached" });
  });
});

describe("summarizeSessionUsage", () => {
  it("groups bytes by session with the current session first", () => {
    const usage = summarizeSessionUsage(
      [
        record("a", 10, 1, ["Old"]),
        record("b", 20, 1, ["Old", "Now"]),
        record("c", 5, 1, ["Other"]),
        record("d", 7, 1, ["Now", "Other"]),
        record("e", 3, 1),
      ],
      "Now",
      new Set(["b"]),
    );
    assert.deepEqual(usage, [
      { session: "Now", bytes: 20, count: 1, current: true },
      { session: "Other", bytes: 12, count: 2, current: false },
      { session: "Old", bytes: 10, count: 1, current: false },
      { session: "Earlier sessions", bytes: 3, count: 1, current: false },
    ]);
  });
});

describe("formatBytes", () => {
  it("formats sizes with binary units", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(1536), "1.5 KB");
    assert.equal(formatBytes(250 * MB), "250 MB");
    assert.equal(formatBytes(5 * 1024 * MB), "5.0 GB");
  });
});
