// Right-click menus for arrangement clips, empty lane space and source
// clips, and where their clipboard actions put clips.
import type { ContextMenuEntry } from "./context-menu.ts";
import { MAX_LAYERS } from "./selection-overlaps.ts";
import type { DropClip, DropLane, SourceClipDrop } from "./source-clip-drop.ts";

// Clips that only touch the playhead are not split by it.
const EPSILON = 0.0001;

// Shortcut hints use the platform's primary modifier.
export function formatShortcut(key: string, mac: boolean) {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
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
      shortcut: mac ? "⌫" : "Del",
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
