import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClipMenuEntries,
  buildSelectionMenuEntries,
  buildSourceSpanMenuEntries,
  type ClipMenuActions,
  type CopyToLayerTarget,
  canSplitAt,
  copyClipToLayer,
  isInSelection,
  NO_FOOTAGE_TITLE,
  resolvePasteLaneId,
  sourceTrackKeyNumber,
} from "./clip-menu.ts";
import type { ContextMenuEntry, ContextMenuItem } from "./context-menu.ts";
import { MAX_LAYERS } from "./selection-overlaps.ts";

type Lane = { id: string; name: string };
type Clip = {
  id: string;
  laneId: string;
  startQ: number;
  durationSeconds: number;
};

const lane = (id: string): Lane => ({ id, name: `Layer ${id}` });
const lanesUpTo = (count: number) =>
  Array.from({ length: count }, (_, index) => lane(`${index + 1}`));
const clip = (
  id: string,
  laneId: string,
  startQ: number,
  endQ: number,
): Clip => ({ id, laneId, startQ, durationSeconds: endQ - startQ });

// A stand-in for the app's overlap resolution, at 60 BPM so a second is a
// quarter: the placed clip wins, and clips it covers on its layer keep only
// their part before it.
function trimCovered(clips: Clip[], placed: Clip) {
  const placedEndQ = placed.startQ + placed.durationSeconds;
  return clips.flatMap((item) => {
    if (item.id === placed.id || item.laneId !== placed.laneId) {
      return [item];
    }

    const endQ = item.startQ + item.durationSeconds;
    if (endQ <= placed.startQ || item.startQ >= placedEndQ) {
      return [item];
    }

    const keptQ = placed.startQ - item.startQ;
    return keptQ > 0 ? [{ ...item, durationSeconds: keptQ }] : [];
  });
}

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

function recordingActions() {
  const calls: string[] = [];
  const actions: ClipMenuActions = {
    cut: () => calls.push("cut"),
    copy: () => calls.push("copy"),
    paste: () => calls.push("paste"),
    duplicate: () => calls.push("duplicate"),
    split: () => calls.push("split"),
    remove: () => calls.push("remove"),
  };
  return { actions, calls };
}

describe("resolvePasteLaneId", () => {
  const lanes = lanesUpTo(3);

  it("pastes on the selected clip's layer first", () => {
    assert.equal(resolvePasteLaneId(lanes, "2", "3", "1"), "2");
  });

  it("pastes on the selected layer when no clip is selected", () => {
    assert.equal(resolvePasteLaneId(lanes, undefined, "3", "1"), "3");
  });

  it("falls back to the copied clip's layer", () => {
    assert.equal(resolvePasteLaneId(lanes, undefined, undefined, "1"), "1");
    assert.equal(resolvePasteLaneId(lanes, "gone", "gone", "1"), "1");
  });
});

describe("canSplitAt", () => {
  it("only splits with the playhead strictly inside the clip", () => {
    assert.equal(canSplitAt(4, 8, 6), true);
    assert.equal(canSplitAt(4, 8, 4), false);
    assert.equal(canSplitAt(4, 8, 8), false);
    assert.equal(canSplitAt(4, 8, 10), false);
  });
});

describe("buildClipMenuEntries", () => {
  it("lists the clip actions with shortcuts, Delete after a separator", () => {
    const { actions } = recordingActions();
    const entries = buildClipMenuEntries({
      hasClip: true,
      canPaste: true,
      canSplit: true,
      mac: false,
      actions,
    });
    assert.deepEqual(
      entries.map((entry) => (entry.type === "item" ? entry.label : "—")),
      ["Cut", "Copy", "Paste", "Duplicate", "Split at playhead", "—", "Delete"],
    );
    assert.deepEqual(
      items(entries).map((entry) => entry.shortcut),
      ["Ctrl+X", "Ctrl+C", "Ctrl+V", "Ctrl+D", "Ctrl+E", "Del"],
    );
    assert.equal(
      items(entries).some((entry) => entry.disabled),
      false,
    );
  });

  it("uses Cmd in the shortcut hints on macOS", () => {
    const { actions } = recordingActions();
    const entries = buildClipMenuEntries({
      hasClip: true,
      canPaste: true,
      canSplit: true,
      mac: true,
      actions,
    });
    assert.equal(find(entries, "copy").shortcut, "Cmd+C");
  });

  it("runs the matching action for each item", () => {
    const { actions, calls } = recordingActions();
    const entries = buildClipMenuEntries({
      hasClip: true,
      canPaste: true,
      canSplit: true,
      mac: false,
      actions,
    });
    for (const entry of items(entries)) {
      entry.onSelect?.();
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

  it("disables Paste with an empty clipboard and Split outside the clip", () => {
    const { actions } = recordingActions();
    const entries = buildClipMenuEntries({
      hasClip: true,
      canPaste: false,
      canSplit: false,
      mac: false,
      actions,
    });
    assert.equal(find(entries, "paste").disabled, true);
    assert.equal(find(entries, "split").disabled, true);
    assert.equal(find(entries, "copy").disabled, false);
  });

  it("enables only Paste on empty lane space", () => {
    const { actions } = recordingActions();
    const entries = buildClipMenuEntries({
      hasClip: false,
      canPaste: true,
      canSplit: true,
      mac: false,
      actions,
    });
    assert.deepEqual(
      items(entries)
        .filter((entry) => !entry.disabled)
        .map((entry) => entry.id),
      ["paste"],
    );
  });
});

describe("buildSourceSpanMenuEntries", () => {
  function build(lanes: Lane[]) {
    const targets: CopyToLayerTarget[] = [];
    let copied = 0;
    const entries = buildSourceSpanMenuEntries({
      lanes,
      mac: false,
      copy: () => {
        copied += 1;
      },
      copyToLayer: (target) => targets.push(target),
    });
    return { entries, targets, copied: () => copied };
  }

  it("offers Copy and a Copy to layer submenu: Auto, every layer, New", () => {
    const { entries, copied } = build(lanesUpTo(3));
    find(entries, "copy").onSelect?.();
    assert.equal(copied(), 1);

    const submenu = find(entries, "copy-to-layer").submenu ?? [];
    assert.deepEqual(
      items(submenu).map((entry) => entry.label),
      ["Auto (last free layer)", "Layer 1", "Layer 2", "Layer 3", "New layer"],
    );
    assert.equal(find(submenu, "new").disabled, false);
  });

  it("passes the chosen target to copyToLayer", () => {
    const { entries, targets } = build(lanesUpTo(2));
    const submenu = find(entries, "copy-to-layer").submenu ?? [];
    find(submenu, "auto").onSelect?.();
    find(submenu, "lane-2").onSelect?.();
    find(submenu, "new").onSelect?.();
    assert.deepEqual(targets, [
      { kind: "auto" },
      { kind: "lane", laneId: "2" },
      { kind: "new" },
    ]);
  });

  it("disables New layer at the layer limit", () => {
    const { entries } = build(lanesUpTo(MAX_LAYERS));
    const submenu = find(entries, "copy-to-layer").submenu ?? [];
    assert.equal(find(submenu, "new").disabled, true);
    assert.equal(items(submenu).length, MAX_LAYERS + 2);
  });
});

describe("copyClipToLayer", () => {
  const createLane = () => lane("new");

  it("puts the clip on the chosen layer even where it overlaps", () => {
    const lanes = lanesUpTo(3);
    // Layer 3 is free, so Auto would pick it; Layer 1 is chosen instead.
    const clips = [clip("a", "1", 0, 8), clip("b", "2", 0, 8)];
    const result = copyClipToLayer(
      { kind: "lane", laneId: "1" },
      lanes,
      clips,
      clip("new-clip", "", 4, 12),
      createLane,
      trimCovered,
    );

    assert.ok(result);
    assert.equal(result.lane.id, "1");
    assert.equal(result.createdLane, false);
    assert.equal(result.lanes, lanes);
    assert.equal(result.clip.laneId, "1");
    assert.deepEqual(result.clips, [
      clip("a", "1", 0, 4),
      clip("b", "2", 0, 8),
      clip("new-clip", "1", 4, 12),
    ]);
  });

  it("adds a new layer for New layer, even when a layer is free", () => {
    const lanes = lanesUpTo(2);
    const result = copyClipToLayer(
      { kind: "new" },
      lanes,
      [],
      clip("new-clip", "", 0, 4),
      createLane,
      trimCovered,
    );

    assert.ok(result);
    assert.equal(result.createdLane, true);
    assert.deepEqual(
      result.lanes.map((item) => item.id),
      ["1", "2", "new"],
    );
    assert.equal(result.clip.laneId, "new");
  });

  it("adds nothing for New layer at the layer limit", () => {
    const result = copyClipToLayer(
      { kind: "new" },
      lanesUpTo(MAX_LAYERS),
      [],
      clip("new-clip", "", 0, 4),
      createLane,
      trimCovered,
    );
    assert.equal(result, null);
  });

  it("adds nothing when the chosen layer is gone", () => {
    const result = copyClipToLayer(
      { kind: "lane", laneId: "9" },
      lanesUpTo(2),
      [],
      clip("new-clip", "", 0, 4),
      createLane,
      trimCovered,
    );
    assert.equal(result, null);
  });
});

describe("isInSelection", () => {
  const selection = { laneId: "1", startQ: 4, durationQ: 2 };

  it("is true from the start up to, but not at, the end on its layer", () => {
    assert.equal(isInSelection(selection, "1", 4), true);
    assert.equal(isInSelection(selection, "1", 5.9), true);
    assert.equal(isInSelection(selection, "1", 6), false);
    assert.equal(isInSelection(selection, "1", 3.9), false);
  });

  it("is false on another layer or without a selection", () => {
    assert.equal(isInSelection(selection, "5", 5), false);
    assert.equal(isInSelection(null, "1", 5), false);
  });
});

describe("buildSelectionMenuEntries", () => {
  const tracks = [
    { id: "a", name: "Drums", color: "#f00", hasFootage: true },
    { id: "b", name: "Keys", color: "#0f0", hasFootage: false },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `t${index}`,
      name: `Track ${index + 3}`,
      color: "#00f",
      hasFootage: true,
    })),
  ];

  function build(
    overrides: Partial<Parameters<typeof buildSelectionMenuEntries>[0]> = {},
    calls: string[] = [],
  ) {
    const entries = buildSelectionMenuEntries({
      tracks,
      insertTrack: (index) => calls.push(`track ${index}`),
      clear: () => calls.push("clear"),
      ...overrides,
    });
    return { entries, calls };
  }

  const items = (entries: readonly ContextMenuEntry[]) =>
    entries.filter((entry): entry is ContextMenuItem => entry.type === "item");
  const trackItems = (entries: readonly ContextMenuEntry[]) =>
    items(items(entries)[0]?.submenu ?? []);

  it("offers Insert Track and Clear selection, without Fill until it exists", () => {
    const { entries } = build();
    assert.deepEqual(
      entries.map((entry) => (entry.type === "item" ? entry.id : "---")),
      ["insert-track", "---", "clear-selection"],
    );
  });

  it("adds Insert Fill Layer when the action exists", () => {
    const calls: string[] = [];
    const { entries } = build({ insertFill: () => calls.push("fill") }, calls);
    const fill = items(entries).find((entry) => entry.id === "insert-fill");
    assert.equal(fill?.label, "Insert Fill Layer");
    fill?.onSelect?.();
    assert.deepEqual(calls, ["fill"]);
  });

  it("lists every source track with its swatch and number key", () => {
    assert.deepEqual(
      trackItems(build().entries).map((entry) => [
        entry.label,
        entry.swatch,
        entry.shortcut,
      ]),
      [
        ["Drums", "#f00", "1"],
        ["Keys", "#0f0", "2"],
        ...Array.from({ length: 7 }, (_, index) => [
          `Track ${index + 3}`,
          "#00f",
          `${index + 3}`,
        ]),
        // Only keys 1-9 commit a selection.
        ["Track 10", "#00f", undefined],
      ],
    );
  });

  it("inserts the track at its index, like its number key", () => {
    const { entries, calls } = build();
    const submenu = trackItems(entries);
    submenu[0]?.onSelect?.();
    submenu[9]?.onSelect?.();
    assert.deepEqual(calls, ["track 0", "track 9"]);
  });

  it("disables tracks with no footage in the range", () => {
    const [withFootage, withoutFootage] = trackItems(build().entries);
    assert.equal(withFootage?.disabled, false);
    assert.equal(withFootage?.title, undefined);
    assert.equal(withoutFootage?.disabled, true);
    assert.equal(withoutFootage?.title, NO_FOOTAGE_TITLE);
  });

  it("disables Insert Track without source tracks", () => {
    const [insert] = items(build({ tracks: [] }).entries);
    assert.equal(insert?.disabled, true);
  });

  it("disables inserting while exporting but still clears", () => {
    const calls: string[] = [];
    const { entries } = build(
      { disabled: true, insertFill: () => calls.push("fill") },
      calls,
    );
    const [insert, fill, clear] = items(entries);
    assert.equal(insert?.disabled, true);
    assert.equal(fill?.disabled, true);
    assert.equal(clear?.disabled, undefined);
    clear?.onSelect?.();
    assert.deepEqual(calls, ["clear"]);
  });
});

describe("sourceTrackKeyNumber", () => {
  it("maps the first nine tracks to keys 1-9", () => {
    assert.equal(sourceTrackKeyNumber(0), 1);
    assert.equal(sourceTrackKeyNumber(8), 9);
    assert.equal(sourceTrackKeyNumber(9), undefined);
  });
});
