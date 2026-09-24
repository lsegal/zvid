import {
  decodeWaveformPeaks,
  type WaveformPeaksResult,
} from "./waveform-peaks";

export type WaveformPeaksRequest = { id: number; blob: Blob };

export type WaveformPeaksResponse =
  | { id: number; result: WaveformPeaksResult }
  | { id: number; error: string };

self.onmessage = async (event: MessageEvent<WaveformPeaksRequest>) => {
  const { id, blob } = event.data;
  try {
    const result = await decodeWaveformPeaks(blob);
    const transfer =
      result.status === "ready"
        ? [result.peaks.min.buffer, result.peaks.max.buffer]
        : [];
    self.postMessage({ id, result } satisfies WaveformPeaksResponse, {
      transfer,
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WaveformPeaksResponse);
  }
};
