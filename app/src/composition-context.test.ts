import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPORT_CONTEXT_ATTRIBUTES } from "./composition-context.ts";

describe("EXPORT_CONTEXT_ATTRIBUTES", () => {
  // Export output depends on these; a preview-only change must not reach it.
  it("keeps export's antialiased, non-premultiplied, alpha context", () => {
    assert.deepEqual(EXPORT_CONTEXT_ATTRIBUTES, {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
  });
});
