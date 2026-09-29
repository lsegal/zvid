// Right-click menus for arrangement clips, empty lane space, an uncommitted
// selection and source clips, and where their clipboard actions put clips.
import type { ContextMenuEntry } from "./context-menu.ts";
import { MAX_LAYERS } from "./selection-overlaps.ts";
import type { DropClip, DropLane, SourceClipDrop } from "./source-clip-drop.ts";

// Clips that only touch the playhead are not split by it.
const EPSILON = 0.0001;

// Shortcut hints use the platform's primary modifier.
export function formatShortcut(key: string, mac: boolean) {
  return mac ? `Cmd+${key}` : `Ctrl+${key}`;
}

/**
 * The layer a pasted clip goes on: the selected clip's layer, else the
 * selected layer, else the layer the clip was copied from.
 */
export function resolvePasteLaneId(
  lanes: readonly DropLane[],
  selectedClipLaneId: string | undefined,
  selectedLaneId: string | undefined,
  clipboardLaneId: string,
) {
  for (const laneId of [selectedClipLaneId, selectedLaneId]) {
    if (laneId && lanes.some((lane) => lane.id === laneId)) {
      return laneId;
    }
  }

  return clipboardLaneId;
}

/** Whether the playhead at `playheadQ` falls strictly inside the clip. */
export function canSplitAt(startQ: number, endQ: number, playheadQ: number) {
  return playheadQ > startQ + EPSILON && playheadQ < endQ - EPSILON;
}

export type ClipMenuActions = {
  cut: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  split: () => void;
  remove: () => void;
};

/**
 * The menu for an arrangement clip, or for empty lane space when `hasClip`
 * is false, where only Paste is available.
 */
export function buildClipMenuEntries({
  hasClip,
  canPaste,
  canSplit,
  mac,
  actions,
}: {
  hasClip: boolean;
  canPaste: boolean;
  canSplit: boolean;
  mac: boolean;
  actions: ClipMenuActions;
}): ContextMenuEntry[] {
  return [
    {
      type: "item",
      id: "cut",
      label: "Cut",
      shortcut: formatShortcut("X", mac),
      disabled: !hasClip,
      onSelect: actions.cut,
    },
    {
      type: "item",
      id: "copy",
      label: "Copy",
      shortcut: formatShortcut("C", mac),
      disabled: !hasClip,
      onSelect: actions.copy,
    },
    {
      type: "item",
      id: "paste",
      label: "Paste",
      shortcut: formatShortcut("V", mac),
      disabled: !canPaste,
      onSelect: actions.paste,
    },
    {
      type: "item",
      id: "duplicate",
      label: "Duplicate",
      shortcut: formatShortcut("D", mac),
      disabled: !hasClip,
      onSelect: actions.duplicate,
    },
    {
      type: "item",
      id: "split",
      label: "Split at playhead",
      shortcut: formatShortcut("E", mac),
      disabled: !hasClip || !canSplit,
      onSelect: actions.split,
    },
    { type: "separator" },
    {
      type: "item",
      id: "delete",
      label: "Delete",
      shortcut: "Del",
      disabled: !hasClip,
      onSelect: actions.remove,
    },
  ];
}

// Where "Copy to layer" puts a source clip: the automatic choice, a
// specific layer, or a new one.
export type CopyToLayerTarget =
  | { kind: "auto" }
  | { kind: "lane"; laneId: string }
  | { kind: "new" };

/** The source clip menu: Copy, and "Copy to layer" with every layer. */
export function buildSourceSpanMenuEntries({
  lanes,
  mac,
  copy,
  copyToLayer,
}: {
  lanes: readonly (DropLane & { name: string })[];
  mac: boolean;
  copy: () => void;
  copyToLayer: (target: CopyToLayerTarget) => void;
}): ContextMenuEntry[] {
  const laneEntries = lanes.map<ContextMenuEntry>((lane) => ({
    type: "item",
    id: `lane-${lane.id}`,
    label: lane.name,
    onSelect: () => copyToLayer({ kind: "lane", laneId: lane.id }),
  }));
  return [
    {
      type: "item",
      id: "copy",
      label: "Copy",
      shortcut: formatShortcut("C", mac),
      onSelect: copy,
    },
    {
      type: "item",
      id: "copy-to-layer",
      label: "Copy to layer",
      submenu: [
        {
          type: "item",
          id: "auto",
          label: "Auto (last free layer)",
          onSelect: () => copyToLayer({ kind: "auto" }),
        },
        ...(laneEntries.length
          ? [{ type: "separator" } as const, ...laneEntries]
          : []),
        { type: "separator" },
        {
          type: "item",
          id: "new",
          label: "New layer",
          disabled: lanes.length >= MAX_LAYERS,
          onSelect: () => copyToLayer({ kind: "new" }),
        },
      ],
    },
  ];
}

/**
 * Adds `clip` on a specific layer, even when it overlaps clips there, with
 * `resolveOverlaps` trimming the clips it covers; or on a new layer. (Auto is
 * `dropClipOnFreeLane`, the same as Ctrl/Cmd-click.) Returns `null`, adding
 * nothing, when the layers are full or the layer no longer exists.
 */
export function copyClipToLayer<Lane extends DropLane, Clip extends DropClip>(
  target: Exclude<CopyToLayerTarget, { kind: "auto" }>,
  lanes: Lane[],
  clips: Clip[],
  clip: Clip,
  createLane: () => Lane,
  resolveOverlaps: (clips: Clip[], placed: Clip) => Clip[],
): SourceClipDrop<Lane, Clip> | null {
  if (target.kind === "new") {
    if (lanes.length >= MAX_LAYERS) {
      return null;
    }

    const lane = createLane();
    const placed = { ...clip, laneId: lane.id };
    return {
      lanes: [...lanes, lane],
      clips: [...clips, placed],
      clip: placed,
      lane,
      createdLane: true,
    };
  }

  const lane = lanes.find((item) => item.id === target.laneId);
  if (!lane) {
    return null;
  }

  const placed = { ...clip, laneId: lane.id };
  return {
    lanes,
    clips: resolveOverlaps([...clips, placed], placed),
    clip: placed,
    lane,
    createdLane: false,
  };
}

// A drag-selected range on a layer, not yet committed to a clip.
export type SelectionRange = {
  laneId: string;
  startQ: number;
  durationQ: number;
};

/** Whether position `q` on layer `laneId` falls inside `selection`. */
export function isInSelection(
  selection: SelectionRange | null | undefined,
  laneId: string,
  q: number,
) {
  return (
    selection?.laneId === laneId &&
    q >= selection.startQ &&
    q < selection.startQ + selection.durationQ
  );
}

/**
 * The number key that commits a selection to the source track at `index`,
 * or undefined past the ninth track, which has none.
 */
export function sourceTrackKeyNumber(index: number) {
  return index >= 0 && index < 9 ? index + 1 : undefined;
}

export type SelectionMenuTrack = {
  id: string;
  name: string;
  // CSS colour of the track's swatch.
  color: string;
  // Whether the track has footage anywhere in the selected range.
  hasFootage: boolean;
};

export const NO_FOOTAGE_TITLE = "No footage here";

// Cut, Copy and Delete for the content in a selection's span on its layer.
// They are disabled when the span holds none.
export type SelectionClipboardActions = {
  mac: boolean;
  hasContent: boolean;
  cut: () => void;
  copy: () => void;
  remove: () => void;
};

/**
 * The menu for an uncommitted selection: Cut, Copy and Delete for the span
 * when `clipboard` is available; Insert Track with every source track,
 * committed like pressing its number key; Insert Fill Layer and Insert Text
 * Layer when `insertFill` and `insertText` are available; and Clear
 * selection.
 */
export function buildSelectionMenuEntries({
  tracks,
  disabled = false,
  clipboard,
  insertTrack,
  insertFill,
  insertText,
  clear,
}: {
  tracks: readonly SelectionMenuTrack[];
  // Editing is disabled while exporting.
  disabled?: boolean;
  clipboard?: SelectionClipboardActions;
  insertTrack: (index: number) => void;
  insertFill?: () => void;
  insertText?: () => void;
  clear: () => void;
}): ContextMenuEntry[] {
  const clipboardDisabled = disabled || !clipboard?.hasContent;
  const clipboardEntries: ContextMenuEntry[] = clipboard
    ? [
        {
          type: "item",
          id: "cut",
          label: "Cut",
          shortcut: formatShortcut("X", clipboard.mac),
          disabled: clipboardDisabled,
          onSelect: clipboard.cut,
        },
        {
          type: "item",
          id: "copy",
          label: "Copy",
          shortcut: formatShortcut("C", clipboard.mac),
          disabled: clipboardDisabled,
          onSelect: clipboard.copy,
        },
        {
          type: "item",
          id: "delete",
          label: "Delete",
          shortcut: "Del",
          disabled: clipboardDisabled,
          onSelect: clipboard.remove,
        },
        { type: "separator" },
      ]
    : [];
  const trackEntries = tracks.map<ContextMenuEntry>((track, index) => {
    const keyNumber = sourceTrackKeyNumber(index);
    return {
      type: "item",
      id: `track-${track.id}`,
      label: track.name,
      swatch: track.color,
      shortcut: keyNumber === undefined ? undefined : `${keyNumber}`,
      disabled: disabled || !track.hasFootage,
      title: track.hasFootage ? undefined : NO_FOOTAGE_TITLE,
      onSelect: () => insertTrack(index),
    };
  });
  return [
    ...clipboardEntries,
    {
      type: "item",
      id: "insert-track",
      label: "Insert Track",
      disabled: disabled || !trackEntries.length,
      submenu: trackEntries,
    },
    ...(insertFill
      ? [
          {
            type: "item",
            id: "insert-fill",
            label: "Insert Fill Layer",
            disabled,
            onSelect: insertFill,
          } as const,
        ]
      : []),
    ...(insertText
      ? [
          {
            type: "item",
            id: "insert-text",
            label: "Insert Text Layer",
            disabled,
            onSelect: insertText,
          } as const,
        ]
      : []),
    { type: "separator" },
    {
      type: "item",
      id: "clear-selection",
      label: "Clear selection",
      shortcut: "Esc",
      onSelect: clear,
    },
  ];
}
