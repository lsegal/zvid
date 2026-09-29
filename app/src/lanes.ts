// Pure edits to a project's arrangement layers (lanes): insert, duplicate,
// delete, reorder and rename. A layer owns the clips whose `laneId` and the
// effects whose `trackId` is its id, so those follow it, and each clip owns
// its own stack (`clip:<clipId>`). Each helper returns
// the project itself when nothing changed so history commits can skip no-op
// edits.
import {
  copyClipEffects,
  ensureLayerLayouts,
  pruneClipEffects,
  type SessionEffect,
} from "./fx-stack.ts";
import { MAX_LAYERS } from "./selection-overlaps.ts";

export type LaneLike = { id: string; name: string };
export type LaneClip = { id: string; laneId: string };

export type LaneProject<Lane extends LaneLike, Clip extends LaneClip> = {
  lanes: Lane[];
  clips: Clip[];
  effects: SessionEffect[];
};

export function canAddLane(lanes: readonly LaneLike[]) {
  return lanes.length < MAX_LAYERS;
}

// Lane ids are small integers as strings; a new one is the next unused.
export function createLaneId(lanes: readonly LaneLike[]) {
  const numericIds = lanes
    .map((lane) => Number.parseInt(lane.id, 10))
    .filter((value) => Number.isInteger(value));
  let nextId = Math.max(0, ...numericIds) + 1;

  while (lanes.some((lane) => lane.id === `${nextId}`)) {
    nextId += 1;
  }

  return `${nextId}`;
}

/** "Layer N" for a new layer, skipping names already in use. */
export function getNextLaneName(lanes: readonly LaneLike[]) {
  let number = lanes.length + 1;
  while (lanes.some((lane) => lane.name === `Layer ${number}`)) {
    number += 1;
  }

  return `Layer ${number}`;
}

/**
 * Inserts `lane` at index `at` (clamped), with its own Layout effect.
 * Unchanged at the layer limit.
 */
export function insertLane<Lane extends LaneLike, Clip extends LaneClip>(
  project: LaneProject<Lane, Clip>,
  at: number,
  lane: Lane,
): LaneProject<Lane, Clip> {
  if (!canAddLane(project.lanes)) {
    return project;
  }

  const index = Math.max(0, Math.min(project.lanes.length, Math.trunc(at)));
  return {
    ...project,
    lanes: [
      ...project.lanes.slice(0, index),
      lane,
      ...project.lanes.slice(index),
    ],
    effects: ensureLayerLayouts(project.effects, [lane.id]),
  };
}

/**
 * Adds a copy of layer `laneId` directly below it, named "<name> copy",
 * with copies of its clips and effects. `newLaneId` is the copy's id and
 * `createId` gives each copied clip and effect a fresh id. Unchanged when
 * the layer is missing or at the layer limit.
 */
export function duplicateLane<Lane extends LaneLike, Clip extends LaneClip>(
  project: LaneProject<Lane, Clip>,
  laneId: string,
  newLaneId: string,
  createId: (kind: "clip" | "effect") => string,
): LaneProject<Lane, Clip> {
  const index = project.lanes.findIndex((lane) => lane.id === laneId);
  if (index < 0 || !canAddLane(project.lanes)) {
    return project;
  }

  const source = project.lanes[index];
  const copy: Lane = { ...source, id: newLaneId, name: `${source.name} copy` };
  const sourceClips = project.clips.filter((clip) => clip.laneId === laneId);
  const copiedClips = sourceClips.map((clip) => ({
    ...clip,
    id: createId("clip"),
    laneId: newLaneId,
  }));
  const copiedEffects = project.effects
    .filter((effect) => effect.trackId === laneId)
    .map<SessionEffect>((effect) => ({
      ...effect,
      id: createId("effect"),
      trackId: newLaneId,
      parameters: effect.parameters.map((parameter) => ({ ...parameter })),
    }));
  // The copied stack goes right after the original's, or at the end.
  const lastSourceEffect = project.effects.findLastIndex(
    (effect) => effect.trackId === laneId,
  );
  const insertEffectsAt =
    lastSourceEffect < 0 ? project.effects.length : lastSourceEffect + 1;

  return {
    ...project,
    lanes: [
      ...project.lanes.slice(0, index + 1),
      copy,
      ...project.lanes.slice(index + 1),
    ],
    clips: [...project.clips, ...copiedClips],
    // Each copied clip gets a copy of its clip's own stack too.
    effects: copyClipEffects(
      ensureLayerLayouts(
        [
          ...project.effects.slice(0, insertEffectsAt),
          ...copiedEffects,
          ...project.effects.slice(insertEffectsAt),
        ],
        [newLaneId],
      ),
      sourceClips.map((clip, index) => [clip.id, copiedClips[index].id]),
      project.effects,
      () => createId("effect"),
    ),
  };
}

/**
 * Removes layer `laneId` with its clips and effects. Unchanged when it is
 * missing or the only layer.
 */
export function deleteLane<Lane extends LaneLike, Clip extends LaneClip>(
  project: LaneProject<Lane, Clip>,
  laneId: string,
): LaneProject<Lane, Clip> {
  if (
    project.lanes.length <= 1 ||
    !project.lanes.some((lane) => lane.id === laneId)
  ) {
    return project;
  }

  const clips = project.clips.filter((clip) => clip.laneId !== laneId);
  return {
    ...project,
    lanes: project.lanes.filter((lane) => lane.id !== laneId),
    clips,
    // The layer's stack goes, and so do its clips' own stacks.
    effects: pruneClipEffects(
      project.effects.filter((effect) => effect.trackId !== laneId),
      clips,
    ),
  };
}

/** Whether layer `laneId` can move one step in `direction`. */
export function canMoveLane(
  lanes: readonly LaneLike[],
  laneId: string,
  direction: -1 | 1,
) {
  const index = lanes.findIndex((lane) => lane.id === laneId);
  const target = index + direction;
  return index >= 0 && target >= 0 && target < lanes.length;
}

/**
 * Moves layer `laneId` up (-1) or down (1) one place. Its id, clips and
 * effects stay the same. Unchanged at the top or bottom.
 */
export function moveLane<Lane extends LaneLike, Clip extends LaneClip>(
  project: LaneProject<Lane, Clip>,
  laneId: string,
  direction: -1 | 1,
): LaneProject<Lane, Clip> {
  if (!canMoveLane(project.lanes, laneId, direction)) {
    return project;
  }

  const index = project.lanes.findIndex((lane) => lane.id === laneId);
  const lanes = [...project.lanes];
  [lanes[index], lanes[index + direction]] = [
    lanes[index + direction],
    lanes[index],
  ];
  return { ...project, lanes };
}

/**
 * Renames layer `laneId` to the trimmed `name`. Unchanged when the name is
 * blank or the same.
 */
export function renameLane<Lane extends LaneLike, Clip extends LaneClip>(
  project: LaneProject<Lane, Clip>,
  laneId: string,
  name: string,
): LaneProject<Lane, Clip> {
  const trimmed = name.trim();
  const lane = project.lanes.find((item) => item.id === laneId);
  if (!lane || !trimmed || trimmed === lane.name) {
    return project;
  }

  return {
    ...project,
    lanes: project.lanes.map((item) =>
      item.id === laneId ? { ...item, name: trimmed } : item,
    ),
  };
}
