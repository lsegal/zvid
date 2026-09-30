import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "./test-fixtures.ts";

describe("mapEffects", () => {
  it("defaults effects to enabled", () => {
    assert.ok(load().every((effect) => effect.enabled));
  });
});
