import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPlayheadSignal,
  findNextClipEdgeQ,
} from "./playhead-signal.ts";

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

describe("next clip edge", () => {
  const spans = [
    { startQ: 4, endQ: 8 },
    { startQ: 6, endQ: 12 },
  ];

  it("finds the nearest clip start or end after the playhead", () => {
    assert.equal(findNextClipEdgeQ(spans, 0, 0), 4);
    assert.equal(findNextClipEdgeQ(spans, 4, 0), 6);
    assert.equal(findNextClipEdgeQ(spans, 7, 0), 8);
    assert.equal(findNextClipEdgeQ(spans, 9, 0), 12);
  });

  it("reports no edge once the playhead passes every clip", () => {
    assert.equal(findNextClipEdgeQ(spans, 12, 0), Number.POSITIVE_INFINITY);
    assert.equal(findNextClipEdgeQ([], 0), Number.POSITIVE_INFINITY);
  });

  it("places edges just before each clip boundary", () => {
    assert.equal(findNextClipEdgeQ(spans, 0, 0.5), 3.5);
    assert.equal(findNextClipEdgeQ(spans, 3.5, 0.5), 5.5);
  });
});
