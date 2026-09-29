import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkspaceLock } from "./workspace-lock.ts";

// A single-lock stand-in for navigator.locks with `ifAvailable` and `steal`.
function createFakeLocks() {
  let held: { abort: (error: Error) => void } | null = null;

  return {
    request(
      _name: string,
      options: { ifAvailable?: boolean; steal?: boolean },
      callback: (lock: unknown) => Promise<unknown> | unknown,
    ) {
      if (held && options.ifAvailable) {
        return Promise.resolve(callback(null));
      }
      if (held && options.steal) {
        const previous = held;
        held = null;
        previous.abort(new DOMException("Lock stolen", "AbortError"));
      }
      return new Promise<unknown>((resolve, reject) => {
        const entry = { abort: reject };
        held = entry;
        Promise.resolve(callback({ name: "lock" })).then((value) => {
          if (held === entry) {
            held = null;
          }
          resolve(value);
        }, reject);
      });
    },
  };
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("workspace lock", () => {
  it("lets the first tab own the session and turns the second away", async () => {
    const locks = createFakeLocks();
    const name = `test-${Math.random()}`;
    const first = createWorkspaceLock({ locks, name });
    const second = createWorkspaceLock({ locks, name, acquireWaitMs: 0 });

    assert.equal(await first.acquire(), true);
    assert.equal(await second.acquire(), false);
    assert.equal(first.isOwner(), true);
    assert.equal(second.isOwner(), false);

    first.dispose();
    second.dispose();
  });

  it("hands the session over after the owner saves its changes", async () => {
    const locks = createFakeLocks();
    const name = `test-${Math.random()}`;
    const events: string[] = [];
    const first = createWorkspaceLock({
      locks,
      name,
      onFlushRequest: async () => {
        events.push("flushed");
      },
      onLost: () => events.push("lost"),
    });
    const second = createWorkspaceLock({ locks, name });
    await first.acquire();

    await second.takeOver();
    await tick();

    assert.deepEqual(events, ["flushed", "lost"]);
    assert.equal(first.isOwner(), false);
    assert.equal(second.isOwner(), true);

    first.dispose();
    second.dispose();
  });

  it("takes over anyway when the owner does not answer", async () => {
    const locks = createFakeLocks();
    const name = `test-${Math.random()}`;
    const first = createWorkspaceLock({
      locks,
      name,
      createChannel: null,
    });
    const second = createWorkspaceLock({ locks, name, flushTimeoutMs: 10 });
    await first.acquire();

    await second.takeOver();
    await tick();

    assert.equal(first.isOwner(), false);
    assert.equal(second.isOwner(), true);

    first.dispose();
    second.dispose();
  });

  it("waits briefly for a refreshed page's predecessor to let go", async () => {
    const locks = createFakeLocks();
    const name = `test-${Math.random()}`;
    const previous = createWorkspaceLock({ locks, name });
    const next = createWorkspaceLock({ locks, name, acquireWaitMs: 1000 });
    await previous.acquire();
    setTimeout(() => previous.dispose(), 150);

    assert.equal(await next.acquire(), true);
    next.dispose();
  });

  it("releases the lock on dispose so another tab can own it", async () => {
    const locks = createFakeLocks();
    const name = `test-${Math.random()}`;
    const first = createWorkspaceLock({ locks, name });
    const second = createWorkspaceLock({ locks, name });
    await first.acquire();
    first.dispose();
    await tick();

    assert.equal(await second.acquire(), true);
    second.dispose();
  });

  it("always owns the session when tabs cannot be coordinated", async () => {
    const lock = createWorkspaceLock({ locks: null, createChannel: null });

    assert.equal(await lock.acquire(), true);
    assert.equal(lock.isOwner(), true);
    lock.dispose();
  });
});
