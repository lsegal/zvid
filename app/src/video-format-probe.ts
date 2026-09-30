import type { Input } from "mediabunny";
import type { RecordingProbe } from "./als-import.ts";

/**
 * Frame count, rate and size of an input's primary video track, read from its
 * container metadata, or `null` when it has no video. The size is before
 * rotation, which is returned alongside it.
 */
export async function probeVideoInput(
  input: Input,
): Promise<RecordingProbe | null> {
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    return null;
  }

  const stats = await videoTrack.computePacketStats();
  return {
    numFrames: stats.packetCount,
    frameRate: stats.averagePacketRate,
    width: videoTrack.squarePixelWidth,
    height: videoTrack.squarePixelHeight,
    rotation: videoTrack.rotation,
  };
}
