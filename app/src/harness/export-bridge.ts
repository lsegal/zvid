// The zvidlib bridge that encodes exports and writes the final file, and
// what it can encode on this device.

import type { CanEncodeVideo } from "./export-encoding";

export async function loadExportBridge() {
  const bridge = await import("../../export-bridge/pkg/zvid_export_bridge.js");
  await bridge.default();
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
