import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import {
  CURRENT_SESSION_KEY,
  createWorkspaceStore,
  migrateWorkspaceRecord,
  WORKSPACE_SCHEMA_VERSION,
} from "./workspace-store.ts";

function readAll(factory: IDBFactory) {
  return new Promise<unknown[]>((resolve, reject) => {
    const request = factory.open("zvid-workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const all = database
        .transaction("sessions", "readonly")
        .objectStore("sessions")
        .getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => {
        database.close();
        resolve(all.result);
      };
    };
  });
}

function putRaw(factory: IDBFactory, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open("zvid-workspace", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("sessions", "readwrite");
      transaction.objectStore("sessions").put(value);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

describe("workspace store", () => {
  it("returns null when nothing has been saved", async () => {
    const store = createWorkspaceStore(new IDBFactory());

    assert.equal(await store.loadCurrentSession(), null);
    store.close();
  });

  it("saves, replaces and loads the current session", async () => {
    const store = createWorkspaceStore(new IDBFactory());
    await store.saveCurrentSession({ savedAt: 1, payload: "first" });
    await store.saveCurrentSession({ savedAt: 2, payload: "second" });

    assert.deepEqual(await store.loadCurrentSession(), {
      id: CURRENT_SESSION_KEY,
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: 2,
      payload: "second",
    });
    store.close();
  });

  it("clears the current session", async () => {
    const store = createWorkspaceStore(new IDBFactory());
    await store.saveCurrentSession({ savedAt: 1, payload: "saved" });
    await store.clearCurrentSession();

    assert.equal(await store.loadCurrentSession(), null);
    store.close();
  });

  it("sets a corrupt record aside under a corrupt-<ts> key", async () => {
    const factory = new IDBFactory();
    const store = createWorkspaceStore(factory);
    await store.saveCurrentSession({ savedAt: 1, payload: "{broken" });

    assert.equal(await store.setAsideCurrentSession(1234), "corrupt-1234");
    assert.equal(await store.loadCurrentSession(), null);
    store.close();

    const records = (await readAll(factory)) as {
      id: string;
      record: { payload: string };
    }[];
    assert.deepEqual(
      records.map((record) => record.id),
      ["corrupt-1234"],
    );
    assert.equal(records[0]?.record.payload, "{broken");
  });

  it("rejects records from an unknown schema version", async () => {
    const factory = new IDBFactory();
    await putRaw(factory, {
      id: CURRENT_SESSION_KEY,
      schemaVersion: WORKSPACE_SCHEMA_VERSION + 1,
      savedAt: 1,
      payload: "{}",
    });
    const store = createWorkspaceStore(factory);

    await assert.rejects(store.loadCurrentSession(), /schema version/);
    store.close();
  });

  it("migrates only well-formed records", () => {
    assert.throws(() => migrateWorkspaceRecord(null));
    assert.throws(() =>
      migrateWorkspaceRecord({ schemaVersion: WORKSPACE_SCHEMA_VERSION }),
    );
    assert.deepEqual(
      migrateWorkspaceRecord({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        payload: "{}",
      }),
      {
        id: CURRENT_SESSION_KEY,
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        savedAt: 0,
        payload: "{}",
      },
    );
  });
});
