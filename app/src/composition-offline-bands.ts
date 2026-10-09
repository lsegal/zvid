import { audioMixEndSeconds } from "./audio-mix/mix.ts";
import { renderAudioMixOffline } from "./audio-mix/offline.ts";
import type { AudioMix } from "./audio-mix/resolve.ts";
import { OfflineAudioBands } from "./fx-shaders/audio-bands.ts";

// Export measures audio-reactive effects on the mix at this rate.
const OFFLINE_BANDS_SAMPLE_RATE = 48000;

// Renders `mix` and measures it, for export to read the bands at each
// frame; null when it can't be rendered, so effects render without them.
export function renderOfflineAudioBands(
  mix: AudioMix,
  mediaItems: Parameters<typeof renderAudioMixOffline>[1],
): Promise<OfflineAudioBands | null> {
  const sampleRate = OFFLINE_BANDS_SAMPLE_RATE;
  return renderAudioMixOffline(mix, mediaItems, {
    sampleRate,
    numberOfChannels: 2,
    startSeconds: 0,
    length: Math.ceil(audioMixEndSeconds(mix) * sampleRate),
  })
    .then((channels) =>
      channels ? OfflineAudioBands.fromChannels(channels, sampleRate) : null,
    )
    .catch((error) => {
      console.warn("Export renders effects without audio bands.", error);
      return null;
    });
}
