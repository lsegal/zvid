// The zvidlib bridge that encodes exports and writes the final file, and
// what it can encode on this device.

import type { CanEncodeVideo } from "./export-encoding";

async function load() {
  const bridge = await import("../../export-bridge/pkg/zvid_export_bridge.js");
  await bridge.default();
  return bridge;
}

let bridge: ReturnType<typeof load> | undefined;

// Loads the bridge once. Concurrent probes would otherwise each instantiate
// the module, swapping its memory out from under each other's pending calls.
export function loadExportBridge() {
  bridge ??= load().catch((error) => {
    bridge = undefined;
    throw error;
  });
  return bridge;
}

/** Whether this device can encode `codec` at the given size and bitrate. */
export const canEncodeVideo: CanEncodeVideo = async (
  codec,
  { width, height, bitrate },
) => {
  const bridge = await loadExportBridge();
  return bridge.canEncodeVideo(codec, width, height, Math.round(bitrate));
};
