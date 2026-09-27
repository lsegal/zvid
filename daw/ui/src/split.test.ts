import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSideFraction,
  dragSideFraction,
  keySideFraction,
  loadSideFraction,
  SIDE_DEFAULT_FRACTION,
  SIDE_MAX_FRACTION,
  SIDE_MIN_FRACTION,
  SPLIT_STORAGE_KEY,
  saveSideFraction,
} from "./split.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

test("defaults to a 70/30 split", () => {
  assert.equal(SIDE_DEFAULT_FRACTION, 0.3);
  assert.equal(loadSideFraction(null), 0.3);
  assert.equal(loadSideFraction(memoryStorage()), 0.3);
});

test("clamps the side fraction", () => {
  assert.equal(clampSideFraction(0.05), SIDE_MIN_FRACTION);
  assert.equal(clampSideFraction(0.95), SIDE_MAX_FRACTION);
  assert.equal(clampSideFraction(0.33333), 0.333);
  assert.equal(clampSideFraction(Number.NaN), SIDE_DEFAULT_FRACTION);
});

test("dragging left widens the side column", () => {
  assert.equal(dragSideFraction(0.3, -100, 1000), 0.4);
  assert.equal(dragSideFraction(0.3, 50, 1000), 0.25);
  assert.equal(dragSideFraction(0.3, 900, 1000), SIDE_MIN_FRACTION);
  assert.equal(dragSideFraction(0.3, -100, 0), 0.3);
});

test("keys step and jump the split", () => {
  assert.equal(keySideFraction(0.3, "ArrowLeft"), 0.32);
  assert.equal(keySideFraction(0.3, "ArrowRight"), 0.28);
  assert.equal(keySideFraction(0.3, "Home"), SIDE_MIN_FRACTION);
  assert.equal(keySideFraction(0.3, "End"), SIDE_MAX_FRACTION);
  assert.equal(keySideFraction(0.3, "Enter"), null);
});

test("persists the split", () => {
  const storage = memoryStorage();
  saveSideFraction(storage, 0.42);
  assert.equal(storage.getItem(SPLIT_STORAGE_KEY), "0.42");
  assert.equal(loadSideFraction(storage), 0.42);
  assert.equal(
    loadSideFraction(memoryStorage({ [SPLIT_STORAGE_KEY]: "garbage" })),
    SIDE_DEFAULT_FRACTION,
  );
  assert.equal(
    loadSideFraction(memoryStorage({ [SPLIT_STORAGE_KEY]: "0.9" })),
    SIDE_MAX_FRACTION,
  );
});

test("survives unavailable storage", () => {
  const throwing = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(loadSideFraction(throwing), SIDE_DEFAULT_FRACTION);
  assert.doesNotThrow(() => saveSideFraction(throwing, 0.4));
});
