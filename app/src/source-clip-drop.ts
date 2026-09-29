// Ctrl/Cmd-clicking a source clip drops the whole clip onto the arrangement
// at the same song position: on the last layer with room for it, or on a new
// layer when every layer overlaps it.
import { MAX_LAYERS } from "./selection-overlaps.ts";

export type DropLane = {
  id: string;
};

export type DropClip = {
  laneId: string;
  startQ: number;
  durationSeconds: number;
};

// Clips that only touch edges do not overlap.
const EPSILON = 0.0001;

function secondsToQuarters(seconds: number, bpm: number) {
  return (seconds * bpm) / 60;
}

/**
 * The layer a clip spanning `[startQ, endQ)` drops onto: the last lane with
 * no clip overlapping that range, `"new"` when every lane overlaps it, or
 * `"full"` when every lane overlaps it and no more layers can be created.
 */
export function pickDropLane(
  lanes: readonly DropLane[],
  clips: readonly DropClip[],
  startQ: number,
  endQ: number,
  bpm: number,
): string | "new" | "full" {
  for (let index = lanes.length - 1; index >= 0; index -= 1) {
    const lane = lanes[index];
    const overlaps = clips.some(
      (clip) =>
        clip.laneId === lane.id &&
        clip.startQ < endQ - EPSILON &&
        clip.startQ + secondsToQuarters(clip.durationSeconds, bpm) >
          startQ + EPSILON,
    );
    if (!overlaps) {
      return lane.id;
    }
  }

  return lanes.length >= MAX_LAYERS ? "full" : "new";
}

export type SourceClipDrop<Lane extends DropLane, Clip extends DropClip> = {
  // The same array as the input when the clip goes on an existing lane.
  lanes: Lane[];
  clips: Clip[];
  clip: Clip;
  lane: Lane;
  // Whether `lane` was created for the clip.
  createdLane: boolean;
};

/**
 * Adds `clip` on the layer `pickDropLane` chooses, creating that layer with
 * `createLane` when needed. Returns `null`, adding nothing, when the layers
 * are full.
 */
export function dropClipOnFreeLane<
  Lane extends DropLane,
  Clip extends DropClip,
>(
  lanes: Lane[],
  clips: Clip[],
  clip: Clip,
  bpm: number,
  createLane: () => Lane,
): SourceClipDrop<Lane, Clip> | null {
  const endQ = clip.startQ + secondsToQuarters(clip.durationSeconds, bpm);
  const laneId = pickDropLane(lanes, clips, clip.startQ, endQ, bpm);
  if (laneId === "full") {
    return null;
  }

  const existingLane = lanes.find((lane) => lane.id === laneId);
  const lane = existingLane ?? createLane();
  const placed = { ...clip, laneId: lane.id };
  return {
    lanes: existingLane ? lanes : [...lanes, lane],
    clips: [...clips, placed],
    clip: placed,
    lane,
    createdLane: !existingLane,
  };
}

/** Whether a click asks to drop a source clip: Cmd on macOS, Ctrl elsewhere. */
export function isSourceClipDropClick(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}) {
  return event.ctrlKey || event.metaKey;
}
