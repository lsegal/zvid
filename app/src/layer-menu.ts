// The history labels of the layer actions and the layer limit message. The
// layer header menu itself is built in menus/layer-menu.ts.
import { MAX_LAYERS } from "./selection-overlaps.ts";

export const MAX_LAYERS_MESSAGE = `You already have the maximum of ${MAX_LAYERS} layers.`;

// History labels name the layer as the header shows it before the change.
export const layerHistoryLabels = {
  rename: (name: string) => `Rename ${name}`,
  duplicate: (name: string) => `Duplicate ${name}`,
  remove: (name: string) => `Delete ${name}`,
  insert: (name: string, where: "above" | "below") =>
    `Insert layer ${where} ${name}`,
  move: (name: string, direction: -1 | 1) =>
    `Move ${name} ${direction < 0 ? "up" : "down"}`,
  // Dragging the grip, or picking it up with the keyboard.
  moveTo: (name: string) => `Move ${name}`,
};
