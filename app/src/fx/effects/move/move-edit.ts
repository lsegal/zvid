// Editing a Move's points: which point is selected, the parameters that set
// one, and the parameters that add or remove a waypoint. The canvas path
// and the Move device's point chips both edit through these.
import type { LayerTransform } from "../../../composition-transform.ts";
import {
  type LayerMove,
  MOVE_WAYPOINT_LIMIT,
  moveWaypointPrefix,
  resolveMoveTransform,
} from "./move.ts";

// One of a Move's points: its Start, its End, or waypoint `n` (1-based).
export type MovePoint = "start" | "end" | number;

// A Move's parameter values by key, as an edit writes them.
export type MoveParameterValues = Record<string, number | string>;

export const MOVE_WAYPOINTS_KEY = "Waypoints";

const FIELD_KEYS: Record<keyof LayerTransform, string> = {
  positionX: "PositionX",
  positionY: "PositionY",
  scaleX: "ScaleX",
  scaleY: "ScaleY",
  originX: "OriginX",
  originY: "OriginY",
  rotationDeg: "Rotation",
};

// The key prefix of `point`'s placement parameters.
export function movePointPrefix(point: MovePoint) {
  return point === "start"
    ? "Start"
    : point === "end"
      ? "End"
      : moveWaypointPrefix(point);
}

export function describeMovePoint(point: MovePoint) {
  return point === "start"
    ? "Start"
    : point === "end"
      ? "End"
      : `Waypoint ${point}`;
}

// `point` among a Move's `waypointCount` waypoints: a waypoint past the
// last one is the last one, or the Start when there are none.
export function clampMovePoint(
  point: MovePoint,
  waypointCount: number,
): MovePoint {
  if (typeof point !== "number" || point <= waypointCount) {
    return point;
  }
  return waypointCount > 0 ? waypointCount : "start";
}

// The points in path order: Start, each waypoint, then End.
export function movePoints(waypointCount: number): MovePoint[] {
  return [
    "start",
    ...Array.from({ length: waypointCount }, (_, index) => index + 1),
    "end",
  ];
}

export function movePointTransform(move: LayerMove, point: MovePoint) {
  return point === "start"
    ? move.start
    : point === "end"
      ? move.end
      : (move.waypoints?.[point - 1] ?? move.start);
}

// The parameters placing `point` at `values`.
export function movePointParameters(
  point: MovePoint,
  values: Partial<LayerTransform>,
): MoveParameterValues {
  const prefix = movePointPrefix(point);
  const result: MoveParameterValues = {};
  for (const field of Object.keys(values) as Array<keyof LayerTransform>) {
    const value = values[field];
    if (value !== undefined) {
      result[`${prefix}${FIELD_KEYS[field]}`] = value;
    }
  }
  return result;
}

// The parameters that give a Move exactly `waypoints`, in order.
function waypointParameters(
  waypoints: readonly LayerTransform[],
): MoveParameterValues {
  return Object.assign(
    { [MOVE_WAYPOINTS_KEY]: String(waypoints.length) },
    ...waypoints.map((waypoint, index) =>
      movePointParameters(index + 1, waypoint),
    ),
  );
}

// The Move with its Motion curve straightened, so progress runs evenly along
// its path: the path's shape, without its timing.
function evenMove(move: LayerMove): LayerMove {
  return { ...move, motion: "Linear" };
}

// Inserts a waypoint where the path is at `along` (0 at Start, 1 at End,
// each leg taking an equal share), between that leg's two points. Returns
// the parameters to write and the new waypoint, or undefined when the Move
// already has every waypoint it can.
export function insertMoveWaypoint(move: LayerMove, along: number) {
  const waypoints = move.waypoints ?? [];
  if (waypoints.length >= MOVE_WAYPOINT_LIMIT) {
    return undefined;
  }
  const legs = waypoints.length + 1;
  const leg = Math.max(0, Math.min(legs - 1, Math.floor(along * legs)));
  const inserted = resolveMoveTransform(evenMove(move), along);
  return {
    parameters: waypointParameters([
      ...waypoints.slice(0, leg),
      inserted,
      ...waypoints.slice(leg),
    ]),
    point: leg + 1,
  };
}

// Adds a waypoint after the last one, halfway along the last leg.
export function appendMoveWaypoint(move: LayerMove) {
  const legs = (move.waypoints?.length ?? 0) + 1;
  return insertMoveWaypoint(move, (legs - 0.5) / legs);
}

// Removes waypoint `point` (1-based), closing the path up around it.
export function removeMoveWaypoint(
  move: LayerMove,
  point: number,
): MoveParameterValues {
  const waypoints = move.waypoints ?? [];
  return waypointParameters(
    waypoints.filter((_, index) => index !== point - 1),
  );
}
