// Pure helpers for the horizontal FX device chain: which devices show in
// which group, how knob values are formatted, and the per-device collapse
// state that is kept in localStorage.

import {
  isOrderEffectName,
  parseLayerIdList,
  serializeLayerIdList,
} from "./composition-order.ts";
import {
  FX_EFFECT_DEFINITIONS,
  type FxEffectScope,
  formatRawNumber,
  getEffectDefinition,
} from "./fx-registry.ts";
import {
  type FxDevice,
  type FxDeviceGroup,
  type FxDeviceParameter,
  isLayoutEffectName,
} from "./fx-stack.ts";

export const FX_COLLAPSED_STORAGE_KEY = "zvid-fx-collapsed-devices";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export type FxChainGroups = {
  global: FxDevice[];
  layer: FxDevice[];
  clip: FxDevice[];
};

// The chain's sections, left to right.
export const FX_CHAIN_SECTIONS: readonly FxDeviceGroup[] = [
  "global",
  "layer",
  "clip",
];

// Splits the devices for the selection into the Global stack, the layer's
// own stack and the selected clip's own stack. Audio layers show no devices.
export function groupChainDevices(
  devices: FxDevice[],
  kind: string | undefined,
): FxChainGroups {
  if (kind === "audio") {
    return { global: [], layer: [], clip: [] };
  }

  return {
    global: devices.filter((device) => device.group === "global"),
    layer: devices.filter((device) => device.group === "layer"),
    clip: devices.filter((device) => device.group === "clip"),
  };
}

// The FX panel's title: the selected clip and its layer, else the selected
// layer, else the Global stack alone.
export function getFxPanelTitle(
  layerName: string | undefined,
  clipName: string | undefined,
) {
  if (!layerName) {
    return "Global Effects";
  }
  return clipName
    ? `Clip ${clipName} Effects (${layerName})`
    : `${layerName} Effects`;
}

// What a clip is called in the FX panel: its label, or else the first line
// of its text, so an unnamed clip still reads as one.
export function getFxClipName(label: string, textPreview = "") {
  return label.trim() || textPreview.trim() || "Untitled";
}

export const NO_ORDER_HINT =
  "No Order: layers overlap (Layer 1 on top). Add Order to arrange them.";

// Shown in the Global section when its stack has no Order, so the layers
// overlap instead of being arranged.
export function resolveGlobalOrderHint(globalDevices: readonly FxDevice[]) {
  return globalDevices.some((device) => isOrderEffectName(device.effectName))
    ? undefined
    : NO_ORDER_HINT;
}

// Effects the `group` add menu offers: the known ones designed for that
// stack, except those every layer is already given (Layout). An FX clip's
// stack is the "fxClip" scope.
export function addableEffectsFor(group: FxEffectScope) {
  return FX_EFFECT_DEFINITIONS.filter(
    (definition) =>
      definition.known &&
      !definition.layerDefault &&
      definition.scopes.includes(group),
  );
}

export function getParameterFormat(effectName: string, key: string) {
  const definition = getEffectDefinition(effectName).parameters.find(
    (parameter) => parameter.key === key,
  );
  return definition?.kind === "number" ? definition.format : formatRawNumber;
}

// Knobs fill at most two rows left to right, and never fewer than two
// columns unless there is only one knob.
export function knobColumnCount(knobCount: number) {
  return knobCount <= 1 ? 1 : Math.max(2, Math.ceil(knobCount / 2));
}

// Devices with more full-width controls than this, such as Text, lay them
// out in columns so they fit the panel's height.
const MAX_CONTROL_ROWS = 3;

export function usesColumnLayout(controlCount: number) {
  return controlCount > MAX_CONTROL_ROWS;
}

// Splits a device's parameters into the full-width controls (enums), which
// sit on their own rows first, and the knobs that fill the grid below them.
// A colour listed after a knob, such as the Order's Border after Spacing,
// sits in the knob grid beside it instead.
export function splitDeviceParameters(parameters: FxDeviceParameter[]) {
  const firstKnob = parameters.findIndex(
    (parameter) => parameter.kind === "number",
  );
  const inGrid = (parameter: FxDeviceParameter, index: number) =>
    parameter.kind === "number" ||
    (parameter.kind === "color" && firstKnob >= 0 && index > firstKnob);
  return {
    controls: parameters.filter(
      (parameter, index) => !inGrid(parameter, index),
    ),
    knobs: parameters.filter(inGrid),
  };
}

// The knobs split evenly into rows labelled `labels`, in order, such as a
// Move's Start and End rows. Undefined when there are no labels or the
// knobs don't split evenly, so they fill the usual two rows instead.
export function splitKnobRows<T>(
  knobs: readonly T[],
  labels: readonly string[] | undefined,
) {
  if (!labels?.length || !knobs.length || knobs.length % labels.length !== 0) {
    return undefined;
  }
  const size = knobs.length / labels.length;
  return labels.map((label, index) => ({
    label,
    knobs: knobs.slice(index * size, (index + 1) * size),
  }));
}

export function readCollapsedDevices(storage: KeyValueStorage | undefined) {
  try {
    const parsed: unknown = JSON.parse(
      storage?.getItem(FX_COLLAPSED_STORAGE_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

export function writeCollapsedDevices(
  storage: KeyValueStorage | undefined,
  collapsed: ReadonlySet<string>,
) {
  try {
    storage?.setItem(
      FX_COLLAPSED_STORAGE_KEY,
      JSON.stringify(Array.from(collapsed).sort()),
    );
  } catch {
    // Storage can be unavailable (private mode, quota); collapsing still works.
  }
}

// The collapse-state key of a device's Animation section, kept alongside the
// devices' own.
export function animationCollapseKey(deviceId: string) {
  return `${deviceId}#animation`;
}

export function toggleCollapsedDevice(
  collapsed: ReadonlySet<string>,
  deviceId: string,
) {
  const next = new Set(collapsed);
  if (next.has(deviceId)) {
    next.delete(deviceId);
  } else {
    next.add(deviceId);
  }
  return next;
}

// Where a dragged device would land: the number of panels in its stack whose
// horizontal midpoint is left of the pointer, so 0 is before the first panel
// and `midpoints.length` is after the last.
export function getDropSlot(midpoints: readonly number[], pointerX: number) {
  return midpoints.filter((midpoint) => midpoint < pointerX).length;
}

// Turns a drop slot into the stack index `moveEffect` expects. Slots on
// either side of the dragged device leave it where it is.
export function dropSlotToStackIndex(fromIndex: number, slot: number) {
  return slot > fromIndex ? slot - 1 : slot;
}

export function isNoopDropSlot(fromIndex: number, slot: number) {
  return slot === fromIndex || slot === fromIndex + 1;
}

// How far to scroll the chain while a drag hovers near one of its edges:
// up to `maxStep` pixels per frame, faster the closer the pointer gets.
export function getAutoScrollDelta(
  pointerX: number,
  left: number,
  right: number,
  edge = 48,
  maxStep = 18,
) {
  const width = right - left;
  const zone = Math.min(edge, width / 3);
  if (zone <= 0) {
    return 0;
  }

  if (pointerX < left + zone) {
    return -Math.round(maxStep * Math.min(1, (left + zone - pointerX) / zone));
  }

  if (pointerX > right - zone) {
    return Math.round(
      maxStep * Math.min(1, (pointerX - (right - zone)) / zone),
    );
  }

  return 0;
}

// Parts of the chain that keep their own pointer behaviour: devices (knobs,
// controls and the title bars that reorder them), add slots and buttons.
// Everything else (gaps, padding, the Global divider and the empty space
// after the last slot) is background that hand-grab pans the chain.
export const FX_CHAIN_CONTROL_SELECTOR =
  ".fx-device-panel, .fx-animation-panel, .fx-chain__add, .fx-chain__empty, .fx-chain__layer-off, button, input, select, textarea, a[href], [role='menu']";

// Whether a press starts hand-grab panning the chain: the primary button on
// its background, or the middle button anywhere, since it operates no
// controls.
export function canStartFxChainPan(event: {
  button: number;
  target: EventTarget | null;
}) {
  if (event.button === 1) {
    return true;
  }

  const target = event.target as { closest?: (selector: string) => unknown };
  return event.button === 0 && !target?.closest?.(FX_CHAIN_CONTROL_SELECTOR);
}

// Screen reader text for a device that moved within its stack.
export function describeDeviceMove(
  device: Pick<FxDevice, "name" | "group" | "subtitle">,
  toIndex: number,
  stackSize: number,
) {
  const stack = device.group === "global" ? "Global" : device.subtitle;
  return `Moved ${device.name} to position ${toIndex + 1} of ${stackSize} in ${stack}`;
}

type SelectableLane = { id: string };
type SelectableClip = { id: string; laneId: string };
type LaneEffect = { trackId: string; effectName: string };

// The layer selected when a session opens: the first one with effects
// besides the Layout every layer has, or else the first layer.
export function getDefaultLaneId(
  lanes: readonly SelectableLane[],
  effects: readonly LaneEffect[],
) {
  return (
    lanes.find((lane) =>
      effects.some(
        (effect) =>
          effect.trackId === lane.id && !isLayoutEffectName(effect.effectName),
      ),
    )?.id ?? lanes[0]?.id
  );
}

// The layer one step above (-1) or below (1) the current one, stopping at
// the first and last layer.
export function stepSelectedLaneId(
  lanes: readonly SelectableLane[],
  currentLaneId: string | undefined,
  direction: -1 | 1,
) {
  const index = lanes.findIndex((lane) => lane.id === currentLaneId);
  if (index === -1) {
    return (direction === 1 ? lanes[0] : lanes[lanes.length - 1])?.id;
  }
  return lanes[Math.min(Math.max(index + direction, 0), lanes.length - 1)].id;
}

// The layer whose effects the FX chain shows. A selected clip selects its
// own layer; otherwise the selected layer is kept while it still exists
// (undo can remove it), falling back to the session default.
export function resolveSelectedLaneId(
  lanes: readonly SelectableLane[],
  effects: readonly LaneEffect[],
  selectedLaneId: string | undefined,
  selectedClip: SelectableClip | undefined,
) {
  if (selectedClip && lanes.some((lane) => lane.id === selectedClip.laneId)) {
    return selectedClip.laneId;
  }
  if (selectedLaneId && lanes.some((lane) => lane.id === selectedLaneId)) {
    return selectedLaneId;
  }
  return getDefaultLaneId(lanes, effects);
}

// A layer an Order's Layers menu lists, in timeline order.
export type FxLayerOption = {
  id: string;
  // Its position in the timeline, from 1.
  number: number;
  name: string;
  // The layer's colour, for its swatch.
  color?: string;
};

// The Layers button's label: how many of `layers` the Order arranges.
// Excluded ids of layers that no longer exist don't count.
export function describeArrangedLayers(
  excludedLayers: string | undefined,
  layers: readonly FxLayerOption[],
) {
  const excluded = new Set(parseLayerIdList(excludedLayers));
  const arranged = layers.filter((layer) => !excluded.has(layer.id)).length;
  if (arranged === layers.length) {
    return "Layers: All";
  }
  return arranged ? `Layers: ${arranged} of ${layers.length}` : "Layers: None";
}

// The stored exclusions that leave every one of `layers` out.
export function excludeAllLayers(layers: readonly FxLayerOption[]) {
  return serializeLayerIdList(layers.map((layer) => layer.id));
}
