// Mixes the Audio row's waveform off the main thread (see
// audio-mix-peaks-loader.ts).
import { type AudioMixContribution, toMixPeaksClip } from "./audio-mix-clips";
import { mixWaveformPeaks } from "./audio-mix-peaks";
import type { WaveformPeaks } from "./waveform-peaks";

export type MixPeaksSource = AudioMixContribution & { peaks: WaveformPeaks };

export type MixPeaksRequest = { id: number; clips: MixPeaksSource[] };

export type MixPeaksResponse =
  | { id: number; peaks: WaveformPeaks | null }
  | { id: number; error: string };

self.onmessage = (event: MessageEvent<MixPeaksRequest>) => {
  const { id, clips } = event.data;
  try {
    const peaks = mixWaveformPeaks(
      clips.map((clip) => toMixPeaksClip(clip, clip.peaks)),
    );
    self.postMessage({ id, peaks } satisfies MixPeaksResponse, {
      transfer: peaks ? [peaks.min.buffer, peaks.max.buffer] : [],
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies MixPeaksResponse);
  }
};
