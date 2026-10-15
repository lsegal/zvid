import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LAYERS_COLLAPSED_STORAGE_KEY,
  layersToggleLabel,
  readLayersCollapsed,
  writeLayersCollapsed,
} from "./layers-section.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("layers section", () => {
  it("persists the collapsed preference", () => {
    const storage = memoryStorage();
    assert.equal(readLayersCollapsed(storage), false);
    writeLayersCollapsed(storage, true);
    assert.equal(storage.getItem(LAYERS_COLLAPSED_STORAGE_KEY), "true");
    assert.equal(readLayersCollapsed(storage), true);
    writeLayersCollapsed(storage, false);
    assert.equal(readLayersCollapsed(storage), false);
  });

  it("tolerates unavailable storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readLayersCollapsed(broken), false);
    assert.equal(readLayersCollapsed(undefined), false);
    assert.doesNotThrow(() => writeLayersCollapsed(broken, true));
  });

  it("labels the toggle with what pressing it does", () => {
    assert.equal(layersToggleLabel(false), "Hide layers");
    assert.equal(layersToggleLabel(true), "Show layers");
  });
});
