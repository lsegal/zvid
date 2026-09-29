// Pure helpers for the horizontal FX device chain: which devices show in
// which group, how knob values are formatted, and the per-device collapse
// state that is kept in localStorage.

import { isOrderEffectName } from "./composition-order.ts";
import {
  FX_EFFECT_DEFINITIONS,
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
  layer: FxDevice[];
  global: FxDevice[];
};

// Splits the devices for the selected clip into the layer's own stack and
// the Global stack. Audio layers show no devices.
export function groupChainDevices(
  devices: FxDevice[],
  kind: string | undefined,
): FxChainGroups {
  if (kind === "audio") {
    return { layer: [], global: [] };
  }

  return {
    layer: devices.filter((device) => device.group === "layer"),
    global: devices.filter((device) => device.group === "global"),
  };
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
// stack, except those every layer is already given (Layout).
export function addableEffectsFor(group: FxDeviceGroup) {
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
export function splitDeviceParameters(parameters: FxDeviceParameter[]) {
  return {
    controls: parameters.filter((parameter) => parameter.kind !== "number"),
    knobs: parameters.filter((parameter) => parameter.kind === "number"),
  };
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
  ".fx-device-panel, .fx-chain__add, .fx-chain__empty, .fx-chain__layer-off, button, input, select, textarea, a[href], [role='menu']";

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
