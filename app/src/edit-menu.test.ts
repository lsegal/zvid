import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry, ContextMenuItem } from "./context-menu.ts";
import { buildClipMenuEntries, type ClipMenuActions } from "./menus/clip-menu.ts";
import { buildEditMenuEntries } from "./menus/edit-menu.ts";
import { buildSelectionMenuEntries } from "./menus/selection-menu.ts";

function items(entries: readonly ContextMenuEntry[]) {
  return entries.filter(
    (entry): entry is ContextMenuItem => entry.type === "item",
  );
}

function find(entries: readonly ContextMenuEntry[], id: string) {
  const entry = items(entries).find((item) => item.id === id);
  assert.ok(entry, `missing ${id}`);
  return entry;
}

// Entry ids, with "-" for separators, to check layout and ordering.
function layout(entries: readonly ContextMenuEntry[]) {
  return entries.map((entry) => (entry.type === "item" ? entry.id : "-"));
}

const history: ContextMenuEntry[] = [
  { type: "item", id: "undo", label: "Undo" },
  { type: "item", id: "redo", label: "Redo" },
];

function clipEntries({
  hasClip = true,
  canPaste = true,
  canSplit = true,
  calls = [] as string[],
} = {}) {
  const record = (name: string) => () => {
    calls.push(name);
  };
  const actions: ClipMenuActions = {
    jumpToStart: record("jumpToStart"),
    cut: record("cut"),
    copy: record("copy"),
    paste: record("paste"),
    duplicate: record("duplicate"),
    split: record("split"),
    remove: record("remove"),
  };
  return buildClipMenuEntries({
    hasClip,
    canPaste,
    canSplit,
    mac: false,
    actions,
  });
}

function selectionEntries(calls: string[] = []) {
  const record = (name: string) => () => {
    calls.push(name);
  };
  return buildSelectionMenuEntries({
    tracks: [{ id: "a", name: "Drums", color: "#f00", hasFootage: true }],
    clipboard: {
      mac: false,
      hasContent: true,
      cut: record("cut selection"),
      copy: record("copy selection"),
      remove: record("delete selection"),
    },
    insertTrack: record("insert track"),
    clear: record("clear"),
  });
}

const layerEntries: ContextMenuEntry[] = [
  { type: "item", id: "rename", label: "Rename…" },
  { type: "separator" },
  { type: "item", id: "move-up", label: "Move up", disabled: true },
];

const audioEntries: ContextMenuEntry[] = [
  { type: "item", id: "import", label: "Import main audio…" },
];

describe("buildEditMenuEntries", () => {
  it("keeps Cut, Copy and Paste at the top level and the rest under Clip", () => {
    const entries = buildEditMenuEntries(history, {
      clip: "3-Audio",
      clipEntries: clipEntries(),
      layer: { name: "Layer 2", entries: layerEntries },
      audioEntries,
    });

    assert.deepEqual(layout(entries), [
      "undo",
      "redo",
      "-",
      "cut",
      "copy",
      "paste",
      "-",
      "clip",
      "layer",
      "audio",
    ]);
    const clip = find(entries, "clip");
    assert.equal(clip.label, "Clip: 3-Audio");
    assert.deepEqual(layout(clip.submenu ?? []), [
      "jump-to-start",
      "-",
      "duplicate",
      "split",
      "-",
      "delete",
    ]);
    assert.equal(find(clip.submenu ?? [], "duplicate").shortcut, "Ctrl+D");
    assert.equal(find(clip.submenu ?? [], "split").shortcut, "Ctrl+E");
    assert.equal(find(clip.submenu ?? [], "delete").shortcut, "Del");
  });

  it("names the selected layer and keeps its whole menu", () => {
    const entries = buildEditMenuEntries(history, {
      clipEntries: clipEntries({ hasClip: false }),
      layer: { name: "Layer 2", entries: layerEntries },
      audioEntries,
    });

    const layer = find(entries, "layer");
    assert.equal(layer.label, "Layer: Layer 2");
    assert.deepEqual(layer.submenu, layerEntries);
    assert.deepEqual(find(entries, "audio").submenu, audioEntries);
  });

  it("hides Clip and Layer when nothing of that kind is selected", () => {
    const entries = buildEditMenuEntries(history, {
      clipEntries: clipEntries({ hasClip: false }),
      audioEntries,
    });

    assert.deepEqual(layout(entries), [
      "undo",
      "redo",
      "-",
      "cut",
      "copy",
      "paste",
      "-",
      "audio",
    ]);
  });

  it("drops separators left dangling by an empty section", () => {
    const entries = buildEditMenuEntries(history, {
      clipEntries: [],
      audioEntries: [],
    });

    assert.deepEqual(layout(entries), ["undo", "redo"]);
  });

  it("keeps the clip menu's disabled states", () => {
    const entries = buildEditMenuEntries(history, {
      clip: "Intro",
      clipEntries: clipEntries({ canPaste: false, canSplit: false }),
      audioEntries,
    });

    assert.equal(find(entries, "cut").disabled, false);
    assert.equal(find(entries, "paste").disabled, true);
    const clip = find(entries, "clip");
    assert.equal(find(clip.submenu ?? [], "split").disabled, true);
    assert.equal(find(clip.submenu ?? [], "duplicate").disabled, false);

    const empty = buildEditMenuEntries(history, {
      clipEntries: clipEntries({ hasClip: false }),
      audioEntries,
    });
    assert.equal(find(empty, "cut").disabled, true);
    assert.equal(find(empty, "copy").disabled, true);
    assert.equal(find(empty, "paste").disabled, false);
  });

  it("runs the same actions as the right-click menu", () => {
    const calls: string[] = [];
    const entries = buildEditMenuEntries(history, {
      clip: "Intro",
      clipEntries: clipEntries({ calls }),
      audioEntries,
    });
    const clip = find(entries, "clip").submenu ?? [];

    for (const item of [
      find(entries, "cut"),
      find(entries, "copy"),
      find(entries, "paste"),
      find(clip, "duplicate"),
      find(clip, "split"),
      find(clip, "delete"),
    ]) {
      item.onSelect?.();
    }

    assert.deepEqual(calls, [
      "cut",
      "copy",
      "paste",
      "duplicate",
      "split",
      "remove",
    ]);
  });

  it("cuts and copies the selection, and puts its menu under Selection", () => {
    const calls: string[] = [];
    const entries = buildEditMenuEntries(history, {
      clip: "Intro",
      clipEntries: clipEntries({ calls }),
      selectionEntries: selectionEntries(calls),
      audioEntries,
    });

    assert.deepEqual(layout(entries), [
      "undo",
      "redo",
      "-",
      "cut",
      "copy",
      "paste",
      "-",
      "selection",
      "clip",
      "audio",
    ]);
    const selection = find(entries, "selection");
    assert.equal(selection.label, "Selection");
    assert.deepEqual(layout(selection.submenu ?? []), [
      "delete",
      "-",
      "insert-track",
      "-",
      "clear-selection",
    ]);

    for (const item of [
      find(entries, "cut"),
      find(entries, "copy"),
      find(entries, "paste"),
      find(selection.submenu ?? [], "delete"),
    ]) {
      item.onSelect?.();
    }
    assert.deepEqual(calls, [
      "cut selection",
      "copy selection",
      "paste",
      "delete selection",
    ]);
  });
});
