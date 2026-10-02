import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry, ContextMenuItem } from "./context-menu.ts";
import { addableEffectsFor } from "./fx-chain.ts";
import { layerHistoryLabels, MAX_LAYERS_MESSAGE } from "./layer-menu.ts";
import { buildAudioMenuEntries } from "./menus/audio-menu.ts";
import {
  buildLayerMenuEntries,
  type LayerMenuActions,
} from "./menus/layer-menu.ts";
import { MAX_LAYERS } from "./selection-overlaps.ts";

function lanes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${index + 1}`,
    name: `Layer ${index + 1}`,
  }));
}

function item(entries: ContextMenuEntry[], id: string) {
  const found = entries.find(
    (entry): entry is ContextMenuItem =>
      entry.type === "item" && entry.id === id,
  );
  assert.ok(found, `missing ${id}`);
  return found;
}

function recordingActions() {
  const calls: string[] = [];
  const actions: LayerMenuActions = {
    rename: () => calls.push("rename"),
    duplicate: () => calls.push("duplicate"),
    remove: () => calls.push("remove"),
    toggleFx: () => calls.push("toggleFx"),
    addFx: (effectName) => calls.push(`addFx:${effectName}`),
    insertAbove: () => calls.push("insertAbove"),
    insertBelow: () => calls.push("insertBelow"),
    moveUp: () => calls.push("moveUp"),
    moveDown: () => calls.push("moveDown"),
  };
  return { calls, actions };
}

function layerMenu(
  options: Partial<Parameters<typeof buildLayerMenuEntries>[0]> = {},
) {
  const { calls, actions } = recordingActions();
  const entries = buildLayerMenuEntries({
    lanes: lanes(3),
    laneId: "2",
    fxEnabled: true,
    effectCount: 1,
    effects: addableEffectsFor("layer"),
    actions,
    ...options,
  });
  return { calls, entries };
}

describe("buildLayerMenuEntries", () => {
  it("inserts text at the playhead when the action exists", () => {
    const { calls, actions } = recordingActions();
    const entries = buildLayerMenuEntries({
      lanes: lanes(3),
      laneId: "2",
      fxEnabled: true,
      effectCount: 1,
      effects: addableEffectsFor("layer"),
      actions: { ...actions, insertText: () => calls.push("insertText") },
    });
    const insert = item(entries, "insert-text");
    assert.equal(insert.label, "Insert text at playhead");
    insert.onSelect?.();
    assert.deepEqual(calls, ["insertText"]);
    assert.ok(
      !layerMenu().entries.some(
        (entry) => entry.type === "item" && entry.id === "insert-text",
      ),
    );
  });

  it("inserts an FX clip at the playhead when the action exists", () => {
    const { calls, actions } = recordingActions();
    const entries = buildLayerMenuEntries({
      lanes: lanes(3),
      laneId: "2",
      fxEnabled: true,
      effectCount: 1,
      effects: addableEffectsFor("layer"),
      actions: {
        ...actions,
        insertText: () => calls.push("insertText"),
        insertFx: () => calls.push("insertFx"),
      },
    });
    const insert = item(entries, "insert-fx");
    assert.equal(insert.label, "Insert FX clip at playhead");
    assert.equal(
      entries.indexOf(insert),
      entries.indexOf(item(entries, "insert-text")) + 1,
    );
    insert.onSelect?.();
    assert.deepEqual(calls, ["insertFx"]);
    assert.ok(
      !layerMenu().entries.some(
        (entry) => entry.type === "item" && entry.id === "insert-fx",
      ),
    );
  });

  it("lists the layer actions in order", () => {
    const { entries } = layerMenu();
    assert.deepEqual(
      entries.map((entry) => (entry.type === "item" ? entry.label : "—")),
      [
        "Rename…",
        "Duplicate",
        "Delete",
        "—",
        "Disable FX",
        "Add FX",
        "—",
        "Insert layer above",
        "Insert layer below",
        "—",
        "Move up",
        "Move down",
      ],
    );
    assert.ok(
      entries.every((entry) => entry.type !== "item" || !entry.disabled),
    );
  });

  it("runs each action", () => {
    const { calls, entries } = layerMenu();
    for (const entry of entries) {
      if (entry.type === "item" && !entry.submenu) {
        entry.onSelect?.();
      }
    }
    assert.deepEqual(calls, [
      "rename",
      "duplicate",
      "remove",
      "toggleFx",
      "insertAbove",
      "insertBelow",
      "moveUp",
      "moveDown",
    ]);
  });

  it("lists every addable effect under Add FX, audio after video", () => {
    const { calls, entries } = layerMenu();
    const submenu = item(entries, "add-fx").submenu ?? [];
    const addable = addableEffectsFor("layer");
    const names = (domain: "video" | "audio") =>
      addable
        .filter((definition) => (definition.domain ?? "video") === domain)
        .map((definition) => definition.displayName);
    assert.deepEqual(
      submenu.map((entry) => (entry.type === "item" ? entry.label : "|")),
      [...names("video"), "|", ...names("audio")],
    );
    assert.equal(names("audio")[0], "Gain");
    assert.ok(names("audio").includes("Saturation"));
    const first = submenu[0];
    assert.equal(first?.type, "item");
    if (first?.type === "item") {
      first.onSelect?.();
    }
    assert.deepEqual(calls, [
      `addFx:${addableEffectsFor("layer")[0].effectName}`,
    ]);
  });

  it("labels the FX toggle by its state and enables it without FX", () => {
    assert.equal(
      item(layerMenu({ fxEnabled: false }).entries, "toggle-fx").label,
      "Enable FX",
    );
    assert.equal(
      item(layerMenu({ effectCount: 0 }).entries, "toggle-fx").disabled,
      false,
    );
  });

  it("disables moving past the top and bottom", () => {
    const top = layerMenu({ laneId: "1" }).entries;
    assert.equal(item(top, "move-up").disabled, true);
    assert.equal(item(top, "move-down").disabled, false);
    const bottom = layerMenu({ laneId: "3" }).entries;
    assert.equal(item(bottom, "move-up").disabled, false);
    assert.equal(item(bottom, "move-down").disabled, true);
  });

  it("keeps the only layer", () => {
    const { entries } = layerMenu({ lanes: lanes(1), laneId: "1" });
    assert.equal(item(entries, "delete").disabled, true);
    assert.equal(item(entries, "move-up").disabled, true);
    assert.equal(item(entries, "move-down").disabled, true);
  });

  it("disables adding layers at the limit, saying why", () => {
    const { entries } = layerMenu({ lanes: lanes(MAX_LAYERS) });
    for (const id of ["duplicate", "insert-above", "insert-below"]) {
      assert.equal(item(entries, id).disabled, true, id);
      assert.equal(item(entries, id).title, MAX_LAYERS_MESSAGE, id);
    }
    assert.equal(item(entries, "rename").disabled, false);
    assert.equal(item(entries, "delete").disabled, false);
  });

  it("disables everything while exporting", () => {
    const { entries } = layerMenu({ disabled: true });
    assert.ok(
      entries.every((entry) => entry.type !== "item" || entry.disabled),
    );
  });
});

describe("layerHistoryLabels", () => {
  it("names the layer and the action", () => {
    assert.equal(layerHistoryLabels.move("Layer 2", -1), "Move Layer 2 up");
    assert.equal(layerHistoryLabels.move("Layer 2", 1), "Move Layer 2 down");
    assert.equal(layerHistoryLabels.moveTo("Layer 4"), "Move Layer 4");
    assert.equal(layerHistoryLabels.remove("Layer 1"), "Delete Layer 1");
    assert.equal(
      layerHistoryLabels.insert("Layer 1", "above"),
      "Insert layer above Layer 1",
    );
  });
});

describe("buildAudioMenuEntries", () => {
  it("only offers Recompute audio, which refreshes the mix", () => {
    const calls: string[] = [];
    const entries = buildAudioMenuEntries({
      refresh: () => calls.push("refresh"),
    });
    for (const entry of entries) {
      if (entry.type === "item") {
        entry.onSelect?.();
      }
    }
    assert.deepEqual(
      entries.map((entry) => (entry.type === "item" ? entry.label : "")),
      ["Recompute audio"],
    );
    assert.deepEqual(calls, ["refresh"]);
  });
});
