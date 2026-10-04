import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { INITIAL_PROJECT_STATE } from "./app/constants.ts";
import type { ProjectState } from "./app/types.ts";
import {
  createSessionLibraryStore,
  formatSessionTime,
  getDuplicateName,
  getSessionContentHash,
  getSessionContentKey,
  getSessionLibraryName,
  type SessionLibraryEntry,
  sortSessionLibrary,
} from "./session-library.ts";

function entry(
  id: string,
  overrides: Partial<SessionLibraryEntry> = {},
): SessionLibraryEntry {
  return {
    id,
    name: id,
    createdAt: 1,
    updatedAt: 1,
    clipCount: 0,
    contentHash: "",
    payload: `payload-${id}`,
    ...overrides,
  };
}

describe("session library store", () => {
  it("lists nothing before anything is saved", async () => {
    const store = createSessionLibraryStore(new IDBFactory());

    assert.deepEqual(await store.list(), []);
    assert.equal(await store.get("missing"), null);
    store.close();
  });

  it("keeps every entry, newest first, without their payloads", async () => {
    const store = createSessionLibraryStore(new IDBFactory());
    await store.put(entry("a", { updatedAt: 10 }));
    await store.put(entry("b", { updatedAt: 30 }));
    await store.put(entry("c", { updatedAt: 20 }));

    const listed = await store.list();
    assert.deepEqual(
      listed.map((item) => item.id),
      ["b", "c", "a"],
    );
    assert.equal("payload" in (listed[0] ?? {}), false);
    assert.equal((await store.get("c"))?.payload, "payload-c");
    store.close();
  });

  it("persists entries across store instances", async () => {
    const factory = new IDBFactory();
    const first = createSessionLibraryStore(factory);
    await first.put(entry("kept"));
    first.close();

    const second = createSessionLibraryStore(factory);
    assert.deepEqual(
      (await second.list()).map((item) => item.id),
      ["kept"],
    );
    second.close();
  });

  it("updates an entry in place and reports a missing one", async () => {
    const store = createSessionLibraryStore(new IDBFactory());
    await store.put(entry("a", { name: "Old", updatedAt: 5 }));

    assert.equal(await store.update("a", { name: "New" }), true);
    assert.equal(await store.update("gone", { name: "New" }), false);

    const updated = await store.get("a");
    assert.equal(updated?.name, "New");
    assert.equal(updated?.updatedAt, 5);
    assert.equal(updated?.payload, "payload-a");
    assert.equal(await store.get("gone"), null);
    store.close();
  });

  it("deletes only the given entry", async () => {
    const store = createSessionLibraryStore(new IDBFactory());
    await store.put(entry("a"));
    await store.put(entry("b"));

    await store.delete("a");

    assert.deepEqual(
      (await store.list()).map((item) => item.id),
      ["b"],
    );
    store.close();
  });
});

describe("session library names", () => {
  it("names an entry after its session, without the file extension", () => {
    assert.equal(getSessionLibraryName("Live Set.lvp"), "Live Set");
    assert.equal(getSessionLibraryName("Song.ZVD"), "Song");
    assert.equal(getSessionLibraryName("  Demo  "), "Demo");
    assert.equal(getSessionLibraryName(""), "Untitled Session");
    assert.equal(getSessionLibraryName(null), "Untitled Session");
  });

  it("numbers duplicates past names in use", () => {
    assert.equal(getDuplicateName("Demo", ["Demo"]), "Demo copy");
    assert.equal(
      getDuplicateName("Demo", ["Demo", "Demo copy"]),
      "Demo copy 2",
    );
    assert.equal(
      getDuplicateName("Demo", ["Demo copy", "Demo copy 2"]),
      "Demo copy 3",
    );
  });

  it("sorts newest first", () => {
    assert.deepEqual(
      sortSessionLibrary([
        { id: "old", updatedAt: 1 },
        { id: "new", updatedAt: 3 },
        { id: "mid", updatedAt: 2 },
      ]).map((item) => item.id),
      ["new", "mid", "old"],
    );
  });
});

describe("session content key", () => {
  const media = {
    id: "m1",
    name: "clip.mp4",
  } as ProjectState["mediaItems"][number];

  it("ignores media details filled in after opening", () => {
    const opened: ProjectState = {
      ...INITIAL_PROJECT_STATE,
      mediaItems: [media],
    };
    const hydrated: ProjectState = {
      ...opened,
      mediaItems: [{ ...media, durationSeconds: 12 }],
    };

    assert.equal(getSessionContentKey(opened), getSessionContentKey(hydrated));
    assert.equal(
      getSessionContentHash(opened),
      getSessionContentHash(hydrated),
    );
  });

  it("changes with an edit", () => {
    const edited: ProjectState = { ...INITIAL_PROJECT_STATE, bpm: 99 };

    assert.notEqual(
      getSessionContentKey(INITIAL_PROJECT_STATE),
      getSessionContentKey(edited),
    );
    assert.notEqual(
      getSessionContentHash(INITIAL_PROJECT_STATE),
      getSessionContentHash(edited),
    );
    assert.match(getSessionContentHash(edited), /^[0-9a-f]{8}$/);
  });
});

describe("formatSessionTime", () => {
  const now = Date.UTC(2026, 9, 3, 12);

  it("reads recent times relative to now", () => {
    assert.equal(formatSessionTime(now - 10_000, now), "Just now");
    assert.equal(formatSessionTime(now - 5 * 60_000, now), "5 minutes ago");
    assert.equal(formatSessionTime(now - 3 * 3_600_000, now), "3 hours ago");
    assert.equal(formatSessionTime(now - 86_400_000, now), "Yesterday");
  });

  it("reads older times as a date", () => {
    assert.equal(
      formatSessionTime(Date.UTC(2026, 8, 1, 12), now),
      "Sep 1, 2026",
    );
  });
});
