import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isProjectEditAction,
  type ProjectHistoryState,
  projectHistoryReducer,
} from "./project-history.ts";

describe("isProjectEditAction", () => {
  it("counts commits, gestures, undo and redo as edits", () => {
    const updater = (current: number) => current + 1;
    assert.equal(
      isProjectEditAction({ type: "commit", label: "Edit", updater }),
      true,
    );
    assert.equal(isProjectEditAction({ type: "transient", updater }), true);
    assert.equal(isProjectEditAction({ type: "amend", updater }), true);
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

describe("amending", () => {
  type State = { value: number; known?: true };
  const known = (current: State): State =>
    current.known ? current : { ...current, known: true };
  const history: ProjectHistoryState<State> = {
    past: [{ snapshot: { value: 1 }, label: "One" }],
    present: { value: 2 },
    future: [{ snapshot: { value: 3 }, label: "Three" }],
  };

  it("adds no undo step, and changes every state in the history", () => {
    const next = projectHistoryReducer(history, {
      type: "amend",
      updater: known,
    });
    assert.deepEqual(next, {
      past: [{ snapshot: { value: 1, known: true }, label: "One" }],
      present: { value: 2, known: true },
      future: [{ snapshot: { value: 3, known: true }, label: "Three" }],
    });
    const undone = projectHistoryReducer(next, { type: "undo" });
    assert.deepEqual(undone.present, { value: 1, known: true });
    const redone = projectHistoryReducer(undone, { type: "redo" });
    assert.deepEqual(redone.present, { value: 2, known: true });
  });

  it("carries through a gesture's undo step", () => {
    const gesture = projectHistoryReducer(history, {
      type: "transient",
      updater: (current) => ({ ...current, value: 20 }),
    });
    const amended = projectHistoryReducer(gesture, {
      type: "amend",
      updater: known,
    });
    const ended = projectHistoryReducer(amended, {
      type: "commit",
      label: "Gesture",
      updater: (current) => current,
    });
    assert.deepEqual(ended.past.at(-1)?.snapshot, { value: 2, known: true });
    assert.deepEqual(ended.present, { value: 20, known: true });
  });

  it("is no change when the present state has nothing to amend", () => {
    const present = { value: 2, known: true as const };
    const current = { ...history, present };
    const next = projectHistoryReducer(current, {
      type: "amend",
      updater: known,
    });
    assert.equal(next, current);
  });
});
