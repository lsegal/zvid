// The Move effect's parameters: a Transform animated from its Start to its
// End placement along a Motion curve.
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

export function isMoveEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "move";
}

// A Move effect: a Transform animated from `start` to `end` over each clip
// it applies to, along its `motion` curve.
export type LayerMove = {
  start: LayerTransform;
  end: LayerTransform;
  motion: MotionCurve;
};

// Reads a Move effect's parameters: Transform's keys prefixed with "Start"
// and "End", and its Motion curve. Missing or unreadable values keep their
// identity default, as for Transform.
export function parseLayerMove(parameters: TransformParameter[]): LayerMove {
  const start: TransformParameter[] = [];
  const end: TransformParameter[] = [];
  let motion: string | undefined;
  for (const parameter of parameters) {
    const key = parameter.key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key === "motion") {
      motion = parameter.value;
    } else if (key.startsWith("start")) {
      start.push({ ...parameter, key: key.slice("start".length) });
    } else if (key.startsWith("end")) {
      end.push({ ...parameter, key: key.slice("end".length) });
    }
  }

  return {
    start: parseLayerTransform(start),
    end: parseLayerTransform(end),
    motion: parseMotionCurve(motion),
  };
}

// The Transform a Move gives at clip progress `progress` (0 at the clip's
// start, 1 at its end): each field eased from its start to its end value,
// exactly `start` at 0 and `end` at 1.
export function resolveMoveTransform(
  move: LayerMove,
  progress: number,
): LayerTransform {
  const eased = easeMotion(move.motion, progress);
  const transform = { ...IDENTITY_TRANSFORM };
  for (const field of Object.keys(transform) as Array<keyof LayerTransform>) {
    transform[field] =
      (1 - eased) * move.start[field] + eased * move.end[field];
  }
  return transform;
}
