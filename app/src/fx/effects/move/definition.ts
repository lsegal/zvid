import { moveParameters } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import { DEFAULT_MOTION_CURVE, MOTION_CURVES } from "./motion-easing.ts";
import {
  DEFAULT_MOVE_PATH,
  MOVE_EFFECT_NAME,
  MOVE_PATHS,
  MOVE_WAYPOINT_COUNTS,
  MOVE_WAYPOINT_LIMIT,
  moveWaypointPrefix,
} from "./move.ts";

const WAYPOINTS = Array.from(
  { length: MOVE_WAYPOINT_LIMIT },
  (_, index) => index + 1,
);

// Shows a waypoint's row, and Path, only while the Waypoints count reaches
// it.
function waypointsFrom(index: number) {
  return { key: "Waypoints", values: MOVE_WAYPOINT_COUNTS.slice(index) };
}

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 80;

export const definition: FxEffectDefinition = {
  effectName: MOVE_EFFECT_NAME,
  displayName: "Move",
  description:
    "Moves, resizes and rotates each clip from a start to an end placement over its duration, optionally through waypoints.",
  accent: "#ff7f8f",
  category: "transform",
  known: true,
  // On a layer it runs over each of the layer's clips in turn, and on an
  // FX clip it moves the box the FX clip adjusts.
  scopes: ["layer", "clip", "fxClip"],
  knobRows: [
    "Start",
    ...WAYPOINTS.map((index) => ({
      label: `Point ${index}`,
      visibleWhen: waypointsFrom(index),
    })),
    "End",
  ],
  parameters: [
    {
      kind: "enum",
      key: "Motion",
      label: "Motion",
      options: MOTION_CURVES,
      defaultValue: DEFAULT_MOTION_CURVE,
    },
    // How many waypoints are set. The path on the preview and the device's
    // point chips add and remove them, so it has no control of its own.
    {
      kind: "enum",
      key: "Waypoints",
      label: "Waypoints",
      options: MOVE_WAYPOINT_COUNTS,
      defaultValue: "0",
      hidden: true,
    },
    {
      kind: "enum",
      key: "Path",
      label: "Path",
      options: MOVE_PATHS,
      defaultValue: DEFAULT_MOVE_PATH,
      visibleWhen: waypointsFrom(1),
    },
    ...moveParameters("Start"),
    ...WAYPOINTS.flatMap((index) =>
      moveParameters(moveWaypointPrefix(index)).map((parameter) => ({
        ...parameter,
        visibleWhen: waypointsFrom(index),
      })),
    ),
    ...moveParameters("End"),
  ],
};
