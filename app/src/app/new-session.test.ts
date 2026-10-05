import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectHistoryReducer } from "../project-history.ts";
import { DEFAULT_LANES, INITIAL_PROJECT_STATE } from "./constants.ts";
import {
  createNewSessionHistory,
  hasUnsavedSessionChanges,
  isNewSessionShortcut,
  isPristineProjectHistory,
} from "./new-session.ts";
import { patchProjectState } from "./session-project.ts";
import type { ProjectState } from "./types.ts";

function editedHistory() {
  return projectHistoryReducer<ProjectState>(createNewSessionHistory(), {
    type: "commit",
    label: "Change tempo",
    updater: (current) => patchProjectState(current, { bpm: 96 }),
  });
}

function key(
  init: Partial<
    Pick<
      KeyboardEvent,
      "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat"
    >
  >,
) {
  return {
    key: "n",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    ...init,
  };
}

describe("createNewSessionHistory", () => {
  it("is a blank project with one layer and the default settings", () => {
    const history = createNewSessionHistory();
    const project = history.present;

    assert.equal(project, INITIAL_PROJECT_STATE);
    assert.deepEqual(project.lanes, DEFAULT_LANES);
    assert.deepEqual(
      project.lanes.map((lane) => lane.name),
      ["Layer 1"],
    );
    assert.deepEqual(project.sourceTracks, []);
    assert.deepEqual(project.sourceSpans, []);
    assert.deepEqual(project.clips, []);
    assert.deepEqual(project.mediaItems, []);
    assert.equal(project.sessionName, null);
    assert.equal(project.bpm, 120);
    assert.equal(project.fps, INITIAL_PROJECT_STATE.fps);
    assert.equal(project.canvasWidth, INITIAL_PROJECT_STATE.canvasWidth);
    assert.equal(project.canvasHeight, INITIAL_PROJECT_STATE.canvasHeight);
  });

  it("clears the undo history", () => {
    const history = createNewSessionHistory();

    assert.deepEqual(history.past, []);
    assert.deepEqual(history.future, []);
    assert.ok(isPristineProjectHistory(history));
  });

  it("starts from the defaults whatever the previous session held", () => {
    const edited = editedHistory();
    assert.equal(edited.present.bpm, 96);

    const fresh = createNewSessionHistory();
    assert.equal(fresh.present.bpm, 120);
    assert.ok(isPristineProjectHistory(fresh));
  });
});

describe("hasUnsavedSessionChanges", () => {
  it("is true for an edited session that was never saved", () => {
    assert.equal(hasUnsavedSessionChanges(editedHistory(), true), true);
  });

  it("is false once the session is saved", () => {
    assert.equal(hasUnsavedSessionChanges(editedHistory(), false), false);
  });

  it("is false for a blank session, which has nothing to lose", () => {
    assert.equal(
      hasUnsavedSessionChanges(createNewSessionHistory(), true),
      false,
    );
  });
});

describe("isNewSessionShortcut", () => {
  it("takes Cmd+N and Ctrl+N in the desktop app", () => {
    assert.ok(isNewSessionShortcut(key({ metaKey: true }), true));
    assert.ok(isNewSessionShortcut(key({ ctrlKey: true }), true));
    assert.ok(isNewSessionShortcut(key({ ctrlKey: true, key: "N" }), true));
  });

  it("leaves the shortcut to the browser", () => {
    assert.equal(isNewSessionShortcut(key({ metaKey: true }), false), false);
  });

  it("ignores N without the modifier, with Shift, and key repeats", () => {
    assert.equal(isNewSessionShortcut(key({}), true), false);
    assert.equal(
      isNewSessionShortcut(key({ metaKey: true, shiftKey: true }), true),
      false,
    );
    assert.equal(
      isNewSessionShortcut(key({ metaKey: true, repeat: true }), true),
      false,
    );
  });
});
