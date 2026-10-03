import type { InputDevice } from "./record-inputs.ts";
import {
  TRACK_INPUT_DEFAULT,
  TRACK_INPUT_NONE,
  trackInputValue,
} from "./track-record-device.ts";

// The default inputs' dropdowns use the same values as a track's: the
// browser's default device, None, and each device.
export {
  parseTrackInputValue as parseDefaultInputValue,
  trackInputValue as defaultInputValue,
} from "./track-record-device.ts";

export function buildDefaultInputOptions(
  devices: readonly InputDevice[],
  browserDefault: string | undefined,
): { value: string; label: string }[] {
  return [
    {
      value: TRACK_INPUT_DEFAULT,
      label: browserDefault
        ? `System default (${browserDefault})`
        : "System default",
    },
    { value: TRACK_INPUT_NONE, label: "None" },
    ...devices.map((device) => ({
      value: trackInputValue(device.deviceId),
      label: device.label,
    })),
  ];
}

export function describeDeniedInput(kind: "video" | "audio") {
  return kind === "video"
    ? "Camera access was denied. Allow it in your browser's site settings, then pick a camera."
    : "Microphone access was denied. Allow it in your browser's site settings, then pick a microphone.";
}
