// Pure helpers for the horizontal FX device chain: which devices show in
// which group, how knob values are formatted, and the per-device collapse
// state that is kept in localStorage.

import { formatRawNumber, getEffectDefinition } from "./fx-registry.ts";
import type { FxDevice } from "./fx-stack.ts";

export const FX_COLLAPSED_STORAGE_KEY = "zvid-fx-collapsed-devices";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export type FxChainGroups = {
  layer: FxDevice[];
  global: FxDevice[];
};

// Splits the devices for the selected clip into the layer's own stack and
// the Global stack. Audio layers show no devices, and the read-only
// placeholder Layout device is left out, since it is not a real effect.
export function groupChainDevices(
  devices: FxDevice[],
  kind: string | undefined,
): FxChainGroups {
  if (kind === "audio") {
    return { layer: [], global: [] };
  }

  const editable = devices.filter((device) => !device.placeholder);
  return {
    layer: editable.filter((device) => device.group === "layer"),
    global: editable.filter((device) => device.group === "global"),
  };
}

export function getParameterFormat(effectName: string, key: string) {
  const definition = getEffectDefinition(effectName).parameters.find(
    (parameter) => parameter.key === key,
  );
  return definition?.kind === "number" ? definition.format : formatRawNumber;
}

// Knobs fill two rows, adding columns as needed.
export function knobColumnCount(parameterCount: number) {
  return Math.max(1, Math.ceil(parameterCount / 2));
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

// Screen reader text for a device that moved within its stack.
export function describeDeviceMove(
  device: Pick<FxDevice, "name" | "group" | "subtitle">,
  toIndex: number,
  stackSize: number,
) {
  const stack = device.group === "global" ? "Global" : device.subtitle;
  return `Moved ${device.name} to position ${toIndex + 1} of ${stackSize} in ${stack}`;
}
