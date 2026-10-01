import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry } from "../context-menu.ts";
import type { FxEffectDefinition } from "../fx-registry.ts";
import { MAX_LAYERS } from "../selection-overlaps.ts";
import {
  buildMainAudioMenuEntries,
  mainAudioMenuEntries,
} from "./audio-menu.ts";
import { buildClipMenuEntries, clipMenuEntries } from "./clip-menu.ts";
import { buildEditMenuEntries, editMenuEntries } from "./edit-menu.ts";
import { buildHistoryEntries } from "./entries/edit-history.ts";
import { buildLayerMenuEntries, layerMenuEntries } from "./layer-menu.ts";
import {
  assembleMenu,
  type MenuEntryProvider,
  menuSeparator,
} from "./registry.ts";
import {
  buildSelectionMenuEntries,
  selectionMenuEntries,
} from "./selection-menu.ts";
import {
  buildSourceSpanMenuEntries,
  sourceSpanMenuEntries,
} from "./source-span-menu.ts";
import {
  buildSourceTrackMenuEntries,
  sourceTrackMenuEntries,
} from "./source-track-menu.ts";

const noop = () => {};

// One line per entry, submenus indented under their item: the id, label,
// shortcut, swatch, tooltip and whether it is disabled or actionable.
function snapshot(entries: readonly ContextMenuEntry[], depth = 0): string[] {
  const indent = "  ".repeat(depth);
  return entries.flatMap((entry) => {
    if (entry.type === "separator") {
      return [`${indent}---`];
    }

    const line = [
      `${indent}${entry.id}: ${entry.label}`,
      entry.shortcut ? `[${entry.shortcut}]` : "",
      entry.swatch ? `swatch=${entry.swatch}` : "",
      entry.title ? `title="${entry.title}"` : "",
      entry.disabled ? "(disabled)" : "",
      entry.onSelect ? "" : entry.submenu ? "" : "(no action)",
    ]
      .filter(Boolean)
      .join(" ");
    return [line, ...snapshot(entry.submenu ?? [], depth + 1)];
  });
}

const lanes = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `lane-${index + 1}`,
    name: `Layer ${index + 1}`,
  }));

const effects = [
  { effectName: "Blur", displayName: "Blur" },
  { effectName: "Colorize", displayName: "Colorize" },
] as unknown as FxEffectDefinition[];

const clipActions = {
  jumpToStart: noop,
  cut: noop,
  copy: noop,
  paste: noop,
  duplicate: noop,
  split: noop,
  remove: noop,
};

const layerActions = {
  rename: noop,
  duplicate: noop,
  remove: noop,
  toggleFx: noop,
  addFx: noop,
  insertText: noop,
  insertFx: noop,
  insertAbove: noop,
  insertBelow: noop,
  moveUp: noop,
  moveDown: noop,
};

const selectionOptions = {
  tracks: [
    { id: "cam-a", name: "Cam A", color: "#f00", hasFootage: true },
    { id: "cam-b", name: "Cam B", color: "#0f0", hasFootage: false },
  ],
  clipboard: {
    mac: false,
    hasContent: true,
    cut: noop,
    copy: noop,
    remove: noop,
  },
  insertTrack: noop,
  insertFill: noop,
  insertText: noop,
  insertFx: noop,
  clear: noop,
};

function assertRegistry<Context>(
  providers: readonly MenuEntryProvider<Context>[],
) {
  const ids = providers.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids in ${ids}`);
  const orders = providers.map((provider) => provider.order);
  assert.deepEqual(
    orders,
    [...orders].sort((a, b) => a - b),
    "providers are listed in menu order",
  );
}

describe("menu registry", () => {
  it("assembles providers by order, not by list position", () => {
    const providers: MenuEntryProvider<string>[] = [
      {
        id: "b",
        order: 20,
        entries: (label) => [{ type: "item", id: "b", label }],
      },
      menuSeparator("between", 15),
      {
        id: "a",
        order: 10,
        entries: () => [{ type: "item", id: "a", label: "A" }],
      },
    ];
    assert.deepEqual(snapshot(assembleMenu(providers, "B")), [
      "a: A (no action)",
      "---",
      "b: B (no action)",
    ]);
  });

  it("lists every menu's providers once, in order", () => {
    assertRegistry(clipMenuEntries);
    assertRegistry(selectionMenuEntries);
    assertRegistry(layerMenuEntries);
    assertRegistry(mainAudioMenuEntries);
    assertRegistry(sourceSpanMenuEntries);
    assertRegistry(sourceTrackMenuEntries);
    assertRegistry(editMenuEntries);
  });
});

describe("menu snapshots", () => {
  it("clip menu", () => {
    assert.deepEqual(
      snapshot(
        buildClipMenuEntries({
          hasClip: true,
          canPaste: true,
          canSplit: true,
          mac: false,
          actions: clipActions,
        }),
      ),
      CLIP_MENU,
    );
  });

  it("empty lane menu", () => {
    assert.deepEqual(
      snapshot(
        buildClipMenuEntries({
          hasClip: false,
          canPaste: false,
          canSplit: false,
          mac: true,
          actions: clipActions,
        }),
      ),
      EMPTY_LANE_MENU,
    );
  });

  it("selection menu", () => {
    assert.deepEqual(
      snapshot(buildSelectionMenuEntries(selectionOptions)),
      SELECTION_MENU,
    );
  });

  it("selection menu without clipboard or inserts, while exporting", () => {
    assert.deepEqual(
      snapshot(
        buildSelectionMenuEntries({
          tracks: selectionOptions.tracks,
          disabled: true,
          insertTrack: noop,
          clear: noop,
        }),
      ),
      SELECTION_MENU_MINIMAL,
    );
  });

  it("layer menu", () => {
    assert.deepEqual(
      snapshot(
        buildLayerMenuEntries({
          lanes: lanes(3),
          laneId: "lane-2",
          fxEnabled: true,
          effectCount: 2,
          effects,
          actions: layerActions,
        }),
      ),
      LAYER_MENU,
    );
  });

  it("layer menu at the layer limit, without playhead inserts", () => {
    const { insertText: _, insertFx: __, ...actions } = layerActions;
    assert.deepEqual(
      snapshot(
        buildLayerMenuEntries({
          lanes: lanes(MAX_LAYERS),
          laneId: "lane-1",
          fxEnabled: false,
          effectCount: 0,
          effects: [],
          actions,
        }),
      ),
      LAYER_MENU_FULL,
    );
  });

  it("source track menu", () => {
    const tracks = [
      { id: "track-a", name: "Cam A" },
      { id: "track-b", name: "Cam B" },
    ];
    const actions = {
      rename: noop,
      duplicate: noop,
      remove: noop,
      moveUp: noop,
      moveDown: noop,
    };
    assert.deepEqual(
      snapshot(
        buildSourceTrackMenuEntries({ tracks, trackId: "track-a", actions }),
      ),
      SOURCE_TRACK_MENU,
    );
    // Unlike the last layer, the only source track can be deleted.
    assert.deepEqual(
      snapshot(
        buildSourceTrackMenuEntries({
          tracks: tracks.slice(1),
          trackId: "track-b",
          actions,
        }),
      ),
      SOURCE_TRACK_MENU_ONLY,
    );
    assert.deepEqual(
      snapshot(
        buildSourceTrackMenuEntries({
          tracks,
          trackId: "track-b",
          disabled: true,
          actions,
        }),
      ),
      SOURCE_TRACK_MENU_DISABLED,
    );
    // Locked source tracks can still be renamed and duplicated, not deleted
    // or moved.
    assert.deepEqual(
      snapshot(
        buildSourceTrackMenuEntries({
          tracks,
          trackId: "track-a",
          locked: true,
          actions,
        }),
      ),
      SOURCE_TRACK_MENU_LOCKED,
    );
  });

  it("audio menu", () => {
    assert.deepEqual(
      snapshot([
        ...buildMainAudioMenuEntries({
          hasMainAudio: false,
          chooseFile: noop,
          remove: noop,
        }),
        { type: "separator" },
        ...buildMainAudioMenuEntries({
          hasMainAudio: true,
          disabled: true,
          chooseFile: noop,
          remove: noop,
        }),
      ]),
      AUDIO_MENUS,
    );
  });

  it("source clip menu", () => {
    assert.deepEqual(
      snapshot(
        buildSourceSpanMenuEntries({
          lanes: lanes(2),
          mac: false,
          copy: noop,
          copyToLayer: noop,
        }),
      ),
      SOURCE_SPAN_MENU,
    );
  });

  it("edit menu", () => {
    assert.deepEqual(
      snapshot(
        buildEditMenuEntries(
          buildHistoryEntries({
            undoLabel: "Move clip",
            redoLabel: undefined,
            canUndo: true,
            canRedo: false,
            disabled: false,
            shortcuts: { undo: "Ctrl+Z", redo: "Ctrl+Shift+Z" },
            undo: noop,
            redo: noop,
          }),
          {
            clip: "Intro",
            clipEntries: buildClipMenuEntries({
              hasClip: true,
              canPaste: true,
              canSplit: false,
              mac: false,
              actions: clipActions,
            }),
            selectionEntries: buildSelectionMenuEntries(selectionOptions),
            layer: {
              name: "Layer 2",
              entries: buildLayerMenuEntries({
                lanes: lanes(3),
                laneId: "lane-2",
                fxEnabled: true,
                effectCount: 2,
                effects,
                actions: layerActions,
              }),
            },
            audioEntries: buildMainAudioMenuEntries({
              hasMainAudio: true,
              chooseFile: noop,
              remove: noop,
            }),
          },
        ),
      ),
      EDIT_MENU,
    );
  });
});

// The menus as they were built before they became registries.

const CLIP_MENU = [
  "jump-to-start: Jump to start [Ctrl+click]",
  "---",
  "cut: Cut [Ctrl+X]",
  "copy: Copy [Ctrl+C]",
  "paste: Paste [Ctrl+V]",
  "duplicate: Duplicate [Ctrl+D]",
  "split: Split at playhead [Ctrl+E]",
  "---",
  "delete: Delete [Del]",
];

const EMPTY_LANE_MENU = [
  "jump-to-start: Jump to start [Cmd+click] (disabled)",
  "---",
  "cut: Cut [Cmd+X] (disabled)",
  "copy: Copy [Cmd+C] (disabled)",
  "paste: Paste [Cmd+V] (disabled)",
  "duplicate: Duplicate [Cmd+D] (disabled)",
  "split: Split at playhead [Cmd+E] (disabled)",
  "---",
  "delete: Delete [Del] (disabled)",
];

const SELECTION_MENU = [
  "cut: Cut [Ctrl+X]",
  "copy: Copy [Ctrl+C]",
  "delete: Delete [Del]",
  "---",
  "insert-track: Insert Track",
  "  track-cam-a: Cam A [1] swatch=#f00",
  '  track-cam-b: Cam B [2] swatch=#0f0 title="No footage here" (disabled)',
  "insert-fill: Insert Fill Clip",
  "insert-text: Insert Text Clip",
  "insert-fx: Insert FX Clip",
  "---",
  "clear-selection: Clear selection [Esc]",
];

const SELECTION_MENU_MINIMAL = [
  "insert-track: Insert Track (disabled)",
  "  track-cam-a: Cam A [1] swatch=#f00 (disabled)",
  '  track-cam-b: Cam B [2] swatch=#0f0 title="No footage here" (disabled)',
  "---",
  "clear-selection: Clear selection [Esc]",
];

const LAYER_MENU = [
  "rename: Rename…",
  "duplicate: Duplicate",
  "delete: Delete",
  "---",
  "toggle-fx: Disable FX",
  "add-fx: Add FX",
  "  fx-Blur: Blur",
  "  fx-Colorize: Colorize",
  "insert-text: Insert text at playhead",
  "insert-fx: Insert FX clip at playhead",
  "---",
  "insert-above: Insert layer above",
  "insert-below: Insert layer below",
  "---",
  "move-up: Move up",
  "move-down: Move down",
];

const LAYER_MENU_FULL = [
  "rename: Rename…",
  'duplicate: Duplicate title="You already have the maximum of 9 layers." (disabled)',
  "delete: Delete",
  "---",
  "toggle-fx: Enable FX",
  "add-fx: Add FX (disabled)",
  "---",
  'insert-above: Insert layer above title="You already have the maximum of 9 layers." (disabled)',
  'insert-below: Insert layer below title="You already have the maximum of 9 layers." (disabled)',
  "---",
  "move-up: Move up (disabled)",
  "move-down: Move down",
];

const SOURCE_TRACK_MENU = [
  "rename: Rename…",
  "duplicate: Duplicate",
  "delete: Delete",
  "---",
  "move-up: Move up (disabled)",
  "move-down: Move down",
];

const SOURCE_TRACK_MENU_ONLY = [
  "rename: Rename…",
  "duplicate: Duplicate",
  "delete: Delete",
  "---",
  "move-up: Move up (disabled)",
  "move-down: Move down (disabled)",
];

const SOURCE_TRACK_MENU_DISABLED = [
  "rename: Rename… (disabled)",
  "duplicate: Duplicate (disabled)",
  "delete: Delete (disabled)",
  "---",
  "move-up: Move up (disabled)",
  "move-down: Move down (disabled)",
];

const SOURCE_TRACK_MENU_LOCKED = [
  "rename: Rename…",
  "duplicate: Duplicate",
  'delete: Delete title="Source tracks are locked" (disabled)',
  "---",
  'move-up: Move up title="Source tracks are locked" (disabled)',
  'move-down: Move down title="Source tracks are locked" (disabled)',
];

const AUDIO_MENUS = [
  "import: Import main audio…",
  "---",
  "replace: Replace main audio… (disabled)",
  "remove: Remove main audio (disabled)",
];

const SOURCE_SPAN_MENU = [
  "copy: Copy [Ctrl+C]",
  "copy-to-layer: Copy to layer",
  "  auto: Auto (last free layer) [Ctrl+click]",
  "  ---",
  "  lane-lane-1: Layer 1",
  "  lane-lane-2: Layer 2",
  "  ---",
  "  new: New layer",
];

const EDIT_MENU = [
  "undo: Undo Move clip [Ctrl+Z]",
  "redo: Redo [Ctrl+Shift+Z] (disabled)",
  "---",
  "cut: Cut [Ctrl+X]",
  "copy: Copy [Ctrl+C]",
  "paste: Paste [Ctrl+V]",
  "---",
  "selection: Selection",
  "  delete: Delete [Del]",
  "  ---",
  "  insert-track: Insert Track",
  "    track-cam-a: Cam A [1] swatch=#f00",
  '    track-cam-b: Cam B [2] swatch=#0f0 title="No footage here" (disabled)',
  "  insert-fill: Insert Fill Clip",
  "  insert-text: Insert Text Clip",
  "  insert-fx: Insert FX Clip",
  "  ---",
  "  clear-selection: Clear selection [Esc]",
  "clip: Clip: Intro",
  "  jump-to-start: Jump to start [Ctrl+click]",
  "  ---",
  "  duplicate: Duplicate [Ctrl+D]",
  "  split: Split at playhead [Ctrl+E] (disabled)",
  "  ---",
  "  delete: Delete [Del]",
  "layer: Layer: Layer 2",
  "  rename: Rename…",
  "  duplicate: Duplicate",
  "  delete: Delete",
  "  ---",
  "  toggle-fx: Disable FX",
  "  add-fx: Add FX",
  "    fx-Blur: Blur",
  "    fx-Colorize: Colorize",
  "  insert-text: Insert text at playhead",
  "  insert-fx: Insert FX clip at playhead",
  "  ---",
  "  insert-above: Insert layer above",
  "  insert-below: Insert layer below",
  "  ---",
  "  move-up: Move up",
  "  move-down: Move down",
  "audio: Audio",
  "  replace: Replace main audio…",
  "  remove: Remove main audio",
];
