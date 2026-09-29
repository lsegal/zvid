import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProjectEditAction } from "./project-history.ts";

describe("isProjectEditAction", () => {
  it("counts commits, gestures, undo and redo as edits", () => {
    const updater = (current: number) => current + 1;
    assert.equal(
      isProjectEditAction({ type: "commit", label: "Edit", updater }),
      true,
    );
    assert.equal(isProjectEditAction({ type: "transient", updater }), true);
    assert.equal(isProjectEditAction({ type: "undo" }), true);
    assert.equal(isProjectEditAction({ type: "redo" }), true);
  });

  it("does not count a session swapped in from elsewhere", () => {
    assert.equal(isProjectEditAction({ type: "replace", snapshot: 1 }), false);
    assert.equal(
      isProjectEditAction({
        type: "restore",
        history: { past: [], present: 1, future: [] },
      }),
      false,
    );
  });
});
