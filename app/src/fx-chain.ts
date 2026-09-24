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
