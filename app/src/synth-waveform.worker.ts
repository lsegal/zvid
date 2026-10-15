// Folds a MIDI clip's rendered audio into waveform peaks off the main
// thread (see synth-waveform-loader.ts). The audio itself renders in an
// OfflineAudioContext, which workers do not have.
import { peaksOfChannels, type WaveformPeaksResult } from "./waveform-peaks";

export type SynthWaveformRequest = {
  id: number;
  sampleRate: number;
  channels: Float32Array[];
};

export type SynthWaveformResponse = { id: number; result: WaveformPeaksResult };

self.onmessage = (event: MessageEvent<SynthWaveformRequest>) => {
  const { id, sampleRate, channels } = event.data;
  const result = peaksOfChannels(sampleRate, channels);
  const transfer =
    result.status === "ready"
      ? [result.peaks.min.buffer, result.peaks.max.buffer]
      : [];
  self.postMessage({ id, result } satisfies SynthWaveformResponse, {
    transfer,
  });
};
