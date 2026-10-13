// Creating, changing, reordering and deleting layers.
import { patchProjectState } from "../../app/session-project.ts";
import type { Lane } from "../../app/types.ts";
import { setLaneFxEnabled } from "../../fx-stack.ts";
import {
  createLaneId,
  deleteLane,
  getNextLaneName,
  insertLane,
  moveLaneTo,
  renameLane,
} from "../../lanes.ts";
import { setTrackHidden } from "../../track-visibility.ts";
import {
  findLane,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
} from "../helpers.ts";
import { objectSchema } from "../schema.ts";
import { type ControlCommand, ControlFailure } from "../types.ts";

const LAYER_ID = {
  type: "string",
  description: "The layer's id, from get_session.",
} as const;

function describeLayer(lane: Lane, index: number) {
  return {
    id: lane.id,
    name: lane.name,
    index,
    hidden: lane.hidden === true,
    fxEnabled: lane.fxEnabled !== false,
  };
}

export const layerCommands: ControlCommand[] = [
  {
    name: "add_layer",
    description:
      "Adds a layer for clips. Layers are listed top to bottom and higher layers draw over lower ones. Returns the new layer.",
    inputSchema: objectSchema({
      name: { type: "string", description: "The layer's name.", minLength: 1 },
      index: {
        type: "integer",
        description:
          "Where to insert it, 0 for the top; at the bottom when omitted.",
        minimum: 0,
      },
    }),
    edits: true,
    run(host, input) {
      const project = host.getProject();
      const lane: Lane = {
        id: createLaneId(project.lanes),
        name:
          optionalString(input, "name")?.trim() ||
          getNextLaneName(project.lanes),
        colorIndex: -1,
      };
      const index = Math.min(
        optionalNumber(input, "index") ?? project.lanes.length,
        project.lanes.length,
      );
      // Inserting gives the layer its Layout effect.
      host.commit(`Create ${lane.name}`, (current) =>
        patchProjectState(current, insertLane(current, index, lane)),
      );
      return describeLayer(lane, index);
    },
  },
  {
    name: "update_layer",
    description:
      "Renames a layer, hides or shows it, turns its effects on or off, or moves it to another position in the layer list.",
    inputSchema: objectSchema(
      {
        layerId: LAYER_ID,
        name: { type: "string", description: "A new name.", minLength: 1 },
        hidden: {
          type: "boolean",
          description: "Hide the layer (it draws nothing) or show it.",
        },
        fxEnabled: {
          type: "boolean",
          description: "Turn the layer's own effect stack on or off.",
        },
        index: {
          type: "integer",
          description: "Move the layer to this position, 0 for the top.",
          minimum: 0,
        },
      },
      ["layerId"],
    ),
    edits: true,
    run(host, input) {
      const layerId = requireString(input, "layerId");
      const lane = findLane(host.getProject(), layerId);
      const name = optionalString(input, "name");
      const hidden = optionalBoolean(input, "hidden");
      const fxEnabled = optionalBoolean(input, "fxEnabled");
      const index = optionalNumber(input, "index");
      host.commit(`Change ${lane.name}`, (current) => {
        let next = current;
        if (name !== undefined) {
          next = patchProjectState(next, renameLane(next, layerId, name));
        }
        if (hidden !== undefined) {
          next = patchProjectState(next, {
            lanes: setTrackHidden(next.lanes, layerId, hidden),
          });
        }
        if (fxEnabled !== undefined) {
          next = patchProjectState(next, {
            lanes: setLaneFxEnabled(next.lanes, layerId, fxEnabled),
          });
        }
        if (index !== undefined) {
          next = patchProjectState(next, moveLaneTo(next, layerId, index));
        }
        return next;
      });
      const project = host.getProject();
      const lanes = project.lanes;
      const updated = findLane(project, layerId);
      return describeLayer(updated, lanes.indexOf(updated));
    },
  },
  {
    name: "delete_layer",
    description:
      "Deletes a layer with its clips and effects. The last layer can't be deleted.",
    inputSchema: objectSchema({ layerId: LAYER_ID }, ["layerId"]),
    edits: true,
    run(host, input) {
      const project = host.getProject();
      const lane = findLane(project, requireString(input, "layerId"));
      if (project.lanes.length <= 1) {
        throw new ControlFailure(
          "unavailable",
          "A session keeps at least one layer.",
        );
      }
      host.commit(`Delete ${lane.name}`, (current) =>
        patchProjectState(current, deleteLane(current, lane.id)),
      );
      return { deleted: lane.id };
    },
  },
];
