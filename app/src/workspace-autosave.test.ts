import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkspaceAutosave } from "./workspace-autosave.ts";

function setup() {
  let now = 0;
  const timers: { at: number; callback: () => void; id: number }[] = [];
  const idle: (() => void)[] = [];
  const writes: string[] = [];
  let busy = false;
  let version = 0;
  let nextId = 0;
  const autosave = createWorkspaceAutosave({
    serialize: () => `v${version}`,
    write: async (payload) => {
      writes.push(payload);
    },
    isBusy: () => busy,
    delayMs: 500,
    setTimeout(callback, ms) {
      nextId += 1;
      timers.push({ at: now + ms, callback, id: nextId });
      return nextId;
    },
    clearTimeout(handle) {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index !== -1) {
        timers.splice(index, 1);
      }
    },
    requestIdle(callback) {
      idle.push(callback);
    },
  });

  const advance = async (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers
        .filter((timer) => timer.at <= now)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      timers.splice(timers.indexOf(due), 1);
      due.callback();
    }
    await Promise.resolve();
  };
  const runIdle = async () => {
    for (const callback of idle.splice(0)) {
      callback();
    }
    await new Promise((resolve) => setImmediate(resolve));
  };

  return {
    autosave,
    writes,
    advance,
    runIdle,
    change() {
      version += 1;
      autosave.markDirty();
    },
    setBusy(value: boolean) {
      busy = value;
    },
  };
}

describe("workspace autosave", () => {
  it("saves once, 500 ms after the last change, in an idle callback", async () => {
    const harness = setup();
    harness.change();
    await harness.advance(300);
    harness.change();
    await harness.advance(300);
    await harness.runIdle();

    assert.deepEqual(harness.writes, []);

    await harness.advance(200);
    assert.deepEqual(harness.writes, []);
    await harness.runIdle();

    assert.deepEqual(harness.writes, ["v2"]);
    assert.equal(harness.autosave.isDirty(), false);
  });

  it("waits for a gesture to end before saving", async () => {
    const harness = setup();
    harness.setBusy(true);
    harness.change();
    await harness.advance(500);
    await harness.runIdle();
    await harness.advance(2000);
    await harness.runIdle();

    assert.deepEqual(harness.writes, []);

    harness.setBusy(false);
    await harness.advance(500);
    await harness.runIdle();

    assert.deepEqual(harness.writes, ["v1"]);
  });

  it("flushes pending changes at once, even mid-gesture", async () => {
    const harness = setup();
    harness.setBusy(true);
    harness.change();
    await harness.autosave.flush();

    assert.deepEqual(harness.writes, ["v1"]);

    await harness.advance(5000);
    await harness.runIdle();
    assert.deepEqual(harness.writes, ["v1"]);
  });

  it("does nothing on flush when nothing changed", async () => {
    const harness = setup();
    await harness.autosave.flush();

    assert.deepEqual(harness.writes, []);
  });

  it("drops pending changes on cancel", async () => {
    const harness = setup();
    harness.change();
    harness.autosave.cancel();
    await harness.advance(1000);
    await harness.runIdle();
    await harness.autosave.flush();

    assert.deepEqual(harness.writes, []);
  });

  it("reports serialisation and write errors and keeps working", async () => {
    const errors: unknown[] = [];
    let fail = true;
    const writes: string[] = [];
    const autosave = createWorkspaceAutosave({
      serialize: () => "payload",
      write: async (payload) => {
        if (fail) {
          throw new Error("quota");
        }
        writes.push(payload);
      },
      isBusy: () => false,
      onError: (error) => errors.push(error),
    });
    autosave.markDirty();
    await autosave.flush();
    fail = false;
    autosave.markDirty();
    await autosave.flush();
    autosave.dispose();

    assert.equal(errors.length, 1);
    assert.deepEqual(writes, ["payload"]);
  });
});
