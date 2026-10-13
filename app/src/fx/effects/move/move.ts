// The Move effect's parameters: a Transform animated from its Start to its
// End placement, through any waypoints between them, along a Motion curve.
import {
  IDENTITY_TRANSFORM,
  type LayerTransform,
} from "../../../composition-transform.ts";
import {
  parseLayerTransform,
  type TransformParameter,
} from "../transform/transform.ts";
import {
  easeMotion,
  type MotionCurve,
  parseMotionCurve,
} from "./motion-easing.ts";

export const MOVE_EFFECT_NAME = "Move";

// How many waypoints a Move can pass through between Start and End.
export const MOVE_WAYPOINT_LIMIT = 4;

// The waypoint count options, "0" (Start straight to End) upwards.
export const MOVE_WAYPOINT_COUNTS = Array.from(
  { length: MOVE_WAYPOINT_LIMIT + 1 },
  (_, count) => String(count),
);

// How a Move's position runs through its waypoints: straight lines between
// them, or a smooth curve through them.
export const MOVE_PATHS = ["Lines", "Curve"] as const;

export type MovePath = (typeof MOVE_PATHS)[number];

export const DEFAULT_MOVE_PATH: MovePath = "Curve";

// The key prefix of waypoint `index` (1-based): "Point1", "Point2", ...
export function moveWaypointPrefix(index: number) {
  return `Point${index}`;
}

export function isMoveEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "move";
}

// A Move effect: a Transform animated from `start` through each of
// `waypoints` to `end` over each clip it applies to, along its `motion`
// curve. `path` shapes the position between waypoints.
export type LayerMove = {
  start: LayerTransform;
  end: LayerTransform;
  motion: MotionCurve;
  waypoints?: readonly LayerTransform[];
  path?: MovePath;
};

function parseWaypointCount(value: string | undefined) {
  const count = Math.round(Number.parseFloat(value ?? ""));
  return Number.isFinite(count)
    ? Math.max(0, Math.min(MOVE_WAYPOINT_LIMIT, count))
    : 0;
}

function parseMovePath(value: string | undefined): MovePath {
  const normalized = value?.trim().toLowerCase();
  return (
    MOVE_PATHS.find((path) => path.toLowerCase() === normalized) ??
    DEFAULT_MOVE_PATH
  );
}

// Reads a Move effect's parameters: Transform's keys prefixed with "Start",
// "End" and each waypoint's "Point<n>", its Waypoints count and Path, and
// its Motion curve. Waypoints past the count are ignored. Missing or
// unreadable values keep their identity default, as for Transform.
export function parseLayerMove(parameters: TransformParameter[]): LayerMove {
  const start: TransformParameter[] = [];
  const end: TransformParameter[] = [];
  const points: TransformParameter[][] = Array.from(
    { length: MOVE_WAYPOINT_LIMIT },
    () => [],
  );
  let motion: string | undefined;
  let count: string | undefined;
  let path: string | undefined;
  for (const parameter of parameters) {
    const key = parameter.key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const point = /^point(\d+)(.*)$/.exec(key);
    if (key === "motion") {
      motion = parameter.value;
    } else if (key === "waypoints") {
      count = parameter.value;
    } else if (key === "path") {
      path = parameter.value;
    } else if (key.startsWith("start")) {
      start.push({ ...parameter, key: key.slice("start".length) });
    } else if (key.startsWith("end")) {
      end.push({ ...parameter, key: key.slice("end".length) });
    } else if (point) {
      points[Number(point[1]) - 1]?.push({ ...parameter, key: point[2] });
    }
  }

  return {
    start: parseLayerTransform(start),
    end: parseLayerTransform(end),
    motion: parseMotionCurve(motion),
    waypoints: points
      .slice(0, parseWaypointCount(count))
      .map((point) => parseLayerTransform(point)),
    path: parseMovePath(path),
  };
}

// A uniform Catmull-Rom spline from `p1` (t = 0) to `p2` (t = 1), shaped by
// the points either side of them. Exactly `p1` at 0 and `p2` at 1.
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  if (t <= 0) {
    return p1;
  }
  if (t >= 1) {
    return p2;
  }
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
  );
}

// The Transform a Move gives at clip progress `progress` (0 at the clip's
// start, 1 at its end), exactly `start` at 0 and `end` at 1. The Motion
// curve eases progress along the whole path, and each leg between
// neighboring placements takes an equal share of it, so the clip passes
// each waypoint without stopping. Every field runs in a straight line
// along each leg, except that a Curve path bends the position smoothly
// through the waypoints. With no waypoints, each field eases straight from
// its start to its end value.
export function resolveMoveTransform(
  move: LayerMove,
  progress: number,
): LayerTransform {
  const points = [move.start, ...(move.waypoints ?? []), move.end];
  const legs = points.length - 1;
  const along = easeMotion(move.motion, progress) * legs;
  const leg = Math.min(legs - 1, Math.floor(along));
  const eased = along - leg;
  const from = points[leg];
  const to = points[leg + 1];
  const curved = legs > 1 && move.path !== "Lines";
  const transform = { ...IDENTITY_TRANSFORM };
  for (const field of Object.keys(transform) as Array<keyof LayerTransform>) {
    transform[field] =
      curved && (field === "positionX" || field === "positionY")
        ? catmullRom(
            points[Math.max(0, leg - 1)][field],
            from[field],
            to[field],
            points[Math.min(legs, leg + 2)][field],
            eased,
          )
        : (1 - eased) * from[field] + eased * to[field];
  }
  return transform;
}
