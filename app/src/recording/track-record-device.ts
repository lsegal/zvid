import type { InputDevice, RecordInput } from "./record-inputs.ts";

// Whether a track's Record device is expanded. It starts collapsed and
// expands while the track is armed; disarming folds it again unless the
// user expanded it by hand.
export type RecordDeviceFold = { expanded: boolean; userExpanded: boolean };

export function initialRecordDeviceFold(armed: boolean): RecordDeviceFold {
  return { expanded: armed, userExpanded: false };
}

export function foldOnArmChange(
  fold: RecordDeviceFold,
  armed: boolean,
): RecordDeviceFold {
  return { ...fold, expanded: armed || fold.userExpanded };
}

export function toggleRecordDeviceFold(
  fold: RecordDeviceFold,
): RecordDeviceFold {
  const expanded = !fold.expanded;
  return { expanded, userExpanded: expanded };
}

// The values a track's input dropdown offers: the default input, None, and
// each device.
export const TRACK_INPUT_DEFAULT = "default";
export const TRACK_INPUT_NONE = "none";
const DEVICE_PREFIX = "device:";

// The dropdown value for a track's override (undefined: none).
export function trackInputValue(override: RecordInput | undefined) {
  return override === undefined
    ? TRACK_INPUT_DEFAULT
    : override === null
      ? TRACK_INPUT_NONE
      : `${DEVICE_PREFIX}${override}`;
}

// The override a dropdown value sets; undefined clears it.
export function parseTrackInputValue(value: string): RecordInput | undefined {
  if (value === TRACK_INPUT_NONE) {
    return null;
  }
  return value.startsWith(DEVICE_PREFIX)
    ? value.slice(DEVICE_PREFIX.length)
    : undefined;
}

// What the default input is called in "Default (…)": None, its device, or
// the browser's default device.
export function describeDefaultInput(
  input: RecordInput | undefined,
  devices: readonly InputDevice[],
  browserDefault: string | undefined,
) {
  if (input === null) {
    return "None";
  }
  if (input !== undefined) {
    return (
      devices.find((device) => device.deviceId === input)?.label ??
      "Unavailable device"
    );
  }
  return browserDefault ?? "System default";
}

export function buildTrackInputOptions(
  devices: readonly InputDevice[],
  defaultLabel: string,
) {
  return [
    { value: TRACK_INPUT_DEFAULT, label: `Default (${defaultLabel})` },
    { value: TRACK_INPUT_NONE, label: "None" },
    ...devices.map((device) => ({
      value: trackInputValue(device.deviceId),
      label: device.label,
    })),
  ];
}
