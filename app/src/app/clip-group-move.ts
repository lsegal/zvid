import { placeClips, withWindowTiming } from "../range-edit.ts";
import { cloneClipAtStartQ } from "./clip-ops.ts";
import { getClipDurationQ } from "./timeline-math.ts";
import type { ArrangementClip } from "./types.ts";
import { clamp } from "./util.ts";

// A clip dragged along with the others of a multi-selection (#1470): the
// clip it starts from and the clip it becomes, a new id for a Ctrl/Cmd-drag
// duplicate or the same one for a move.
export type ClipGroupMember = { clipId: string; sourceClipId: string };

export type ClipGroupMove = {
  // How far the grabbed clip moved, in quarters and in layers.
  deltaQ: number;
  laneShift: number;
  // The layers top to bottom.
  laneIds: readonly string[];
  totalQuarters: number;
  beatUnit: number;
  bpm: number;
  duplicate: boolean;
};

/**
 * `clips` with every member moved, or duplicated, by the grabbed clip's
 * offset in time and layers. The offset stops where a member would leave
 * the timeline or the layers, so the group keeps its shape. Each member
 * trims the clips it lands on, as a single clip's move does.
 */
export function moveClipGroup(
  clips: readonly ArrangementClip[],
  members: readonly ClipGroupMember[],
  {
    deltaQ,
    laneShift,
    laneIds,
    totalQuarters,
    beatUnit,
    bpm,
    duplicate,
  }: ClipGroupMove,
): ArrangementClip[] {
  const moving = members.flatMap((member) => {
    const source = clips.find((clip) => clip.id === member.sourceClipId);
    return source
      ? [{ member, source, durationQ: getClipDurationQ(source, bpm) }]
      : [];
  });
  if (!moving.length) {
    return [...clips];
  }

  const minDeltaQ = Math.max(...moving.map(({ source }) => -source.startQ));
  const maxDeltaQ = Math.min(
    ...moving.map(
      ({ source, durationQ }) =>
        Math.max(0, totalQuarters - durationQ - beatUnit) - source.startQ,
    ),
  );
  const groupDeltaQ = clamp(deltaQ, minDeltaQ, Math.max(minDeltaQ, maxDeltaQ));
  const laneIndexes = moving
    .map(({ source }) => laneIds.indexOf(source.laneId))
    .filter((index) => index >= 0);
  const groupLaneShift = laneIndexes.length
    ? clamp(
        laneShift,
        -Math.min(...laneIndexes),
        laneIds.length - 1 - Math.max(...laneIndexes),
      )
    : 0;

  const moved = moving.map(({ member, source, durationQ }) => {
    const laneIndex = laneIds.indexOf(source.laneId);
    const clip = duplicate
      ? cloneClipAtStartQ(source, bpm, source.startQ, member.clipId)
      : source;
    return withWindowTiming(
      clip,
      source.startQ + groupDeltaQ,
      durationQ,
      bpm,
      laneIndex >= 0 ? laneIds[laneIndex + groupLaneShift] : source.laneId,
    );
  });
  const movedIds = new Set(moving.map(({ source }) => source.id));
  const kept = duplicate
    ? clips
    : clips.filter((clip) => !movedIds.has(clip.id));
  return placeClips(kept, moved, bpm);
}
