import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LiveTakeStore, recordingEndStepQ } from "./live-take-store.ts";

describe("live take store", () => {
  it("grows every take and tells subscribers once per tick", () => {
    const store = new LiveTakeStore(["a", "b"]);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.advance(1.5);
    assert.equal(store.durationSeconds("a"), 1.5);
    assert.equal(store.durationSeconds("b"), 1.5);
    assert.equal(calls, 1);

    unsubscribe();
    store.advance(2);
    assert.equal(calls, 1);
  });

  it("doesn't notify when nothing changed", () => {
    const store = new LiveTakeStore(["a"]);
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.advance(0);
    store.advance(1);
    store.advance(1);
    assert.equal(calls, 1);
  });

  it("keeps an ended take at the length it reached", () => {
    const store = new LiveTakeStore(["a", "b"]);
    store.advance(1);
    store.end("a");
    store.advance(3);
    assert.equal(store.durationSeconds("a"), 1);
    assert.equal(store.durationSeconds("b"), 3);
  });

  it("reads unknown tracks as empty", () => {
    assert.equal(new LiveTakeStore().durationSeconds("missing"), 0);
  });
});

describe("recording end steps", () => {
  it("rounds the end up to whole bars from where recording started", () => {
    assert.equal(recordingEndStepQ(2, 0, 4), 6);
    assert.equal(recordingEndStepQ(2, 0.1, 4), 6);
    assert.equal(recordingEndStepQ(2, 4, 4), 6);
    assert.equal(recordingEndStepQ(2, 4.01, 4), 10);
  });

  it("only moves once per bar as the take grows", () => {
    const ends = new Set<number>();
    // Five ticks a second for 4 seconds at 120 BPM: 8 quarters, 2 bars.
    for (let tick = 0; tick <= 20; tick += 1) {
      ends.add(recordingEndStepQ(0, tick * 0.2 * 2, 4));
    }
    assert.deepEqual([...ends], [4, 8]);
  });

  it("follows the take exactly without a bar length", () => {
    assert.equal(recordingEndStepQ(1, 2.5, 0), 3.5);
  });
});
