// Where the clip menus' clipboard actions put clips, and helpers the menus
// in menus/ share. The menus themselves are built in menus/.
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

// Where "Copy to layer" puts a source clip: the automatic choice, a
// specific layer, or a new one.
export type CopyToLayerTarget =
  | { kind: "auto" }
  | { kind: "lane"; laneId: string }
  | { kind: "new" };

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
