import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPlayheadSignal } from "./playhead-signal.ts";

describe("playhead signal", () => {
  it("notifies subscribers when the playhead moves", () => {
    const signal = createPlayheadSignal();
    const seen: number[] = [];
    signal.subscribe(() => seen.push(signal.get()));

    signal.set(1.5);
    signal.set(4);

    assert.deepEqual(seen, [1.5, 4]);
    assert.equal(signal.get(), 4);
  });

  it("skips notifications when the playhead does not change", () => {
    const signal = createPlayheadSignal(2);
    let calls = 0;
    signal.subscribe(() => {
      calls += 1;
    });

    signal.set(2);

    assert.equal(calls, 0);
  });

  it("stops notifying after unsubscribing", () => {
    const signal = createPlayheadSignal();
    let calls = 0;
    const unsubscribe = signal.subscribe(() => {
      calls += 1;
    });

    signal.set(1);
    unsubscribe();
    signal.set(2);

    assert.equal(calls, 1);
  });
});
