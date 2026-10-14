import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuItem } from "./context-menu.ts";
import { noteActionForKey, noteMenuEntries } from "./piano-roll-actions.ts";

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...modifiers,
});

describe("piano roll note action keys", () => {
  it("maps arrows, Delete and the clipboard keys", () => {
    assert.equal(noteActionForKey(press("ArrowLeft"), false), "nudgeLeft");
    assert.equal(noteActionForKey(press("ArrowRight"), false), "nudgeRight");
    assert.equal(
      noteActionForKey(press("ArrowLeft", { shiftKey: true }), false),
      "nudgeFineLeft",
    );
    assert.equal(
      noteActionForKey(press("ArrowRight", { shiftKey: true }), false),
      "nudgeFineRight",
    );
    assert.equal(noteActionForKey(press("ArrowUp"), false), "pitchUp");
    assert.equal(noteActionForKey(press("ArrowDown"), false), "pitchDown");
    assert.equal(noteActionForKey(press("Backspace"), false), "delete");
    assert.equal(
      noteActionForKey(press("d", { ctrlKey: true }), false),
      "duplicate",
    );
    assert.equal(noteActionForKey(press("X", { metaKey: true }), true), "cut");
    assert.equal(noteActionForKey(press("c", { metaKey: true }), true), "copy");
    assert.equal(
      noteActionForKey(press("v", { ctrlKey: true }), false),
      "paste",
    );
  });

  it("leaves other modifier combinations to the app", () => {
    // Cmd is the modifier on macOS, Ctrl elsewhere.
    assert.equal(
      noteActionForKey(press("c", { ctrlKey: true }), true),
      undefined,
    );
    assert.equal(
      noteActionForKey(press("c", { metaKey: true }), false),
      undefined,
    );
    assert.equal(
      noteActionForKey(press("ArrowLeft", { metaKey: true }), true),
      undefined,
    );
    assert.equal(
      noteActionForKey(press("ArrowUp", { shiftKey: true }), false),
      undefined,
    );
    assert.equal(
      noteActionForKey(press("ArrowLeft", { altKey: true }), false),
      undefined,
    );
    assert.equal(noteActionForKey(press("d"), false), undefined);
  });
});

describe("piano roll note menu", () => {
  const items = (hasSelection: boolean, canPaste: boolean) =>
    noteMenuEntries({
      mac: true,
      hasSelection,
      canPaste,
      run: () => {},
    }).filter((entry): entry is ContextMenuItem => entry.type === "item");

  it("lists every action with its shortcut", () => {
    assert.deepEqual(
      items(true, true).map((item) => [item.label, item.shortcut]),
      [
        ["Nudge Left", "←"],
        ["Nudge Right", "→"],
        ["Nudge Fine Left", "Shift+←"],
        ["Nudge Fine Right", "Shift+→"],
        ["Pitch Up", "↑"],
        ["Pitch Down", "↓"],
        ["Duplicate", "Cmd+D"],
        ["Cut", "Cmd+X"],
        ["Copy", "Cmd+C"],
        ["Paste", "Cmd+V"],
        ["Delete", "Del"],
      ],
    );
  });

  it("disables Paste without a clipboard and the rest without a selection", () => {
    assert.deepEqual(
      items(false, true)
        .filter((item) => !item.disabled)
        .map((item) => item.id),
      ["paste"],
    );
    assert.deepEqual(
      items(true, false)
        .filter((item) => item.disabled)
        .map((item) => item.id),
      ["paste"],
    );
  });

  it("runs the chosen action", () => {
    const ran: string[] = [];
    const entries = noteMenuEntries({
      mac: false,
      hasSelection: true,
      canPaste: true,
      run: (action) => ran.push(action),
    });
    for (const entry of entries) {
      if (entry.type === "item") {
        entry.onSelect?.();
      }
    }
    assert.equal(ran.length, 11);
    assert.equal(ran[6], "duplicate");
  });
});
