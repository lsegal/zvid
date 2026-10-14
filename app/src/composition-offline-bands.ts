import { audioMixEndSeconds } from "./audio-mix/mix.ts";
import { renderAudioMixOffline } from "./audio-mix/offline.ts";
import { type AudioMix, SILENT_AUDIO_MIX } from "./audio-mix/resolve.ts";
import {
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./fx-shaders/audio-bands.ts";

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

// The bands export reads, measured once per mix: a mix resolved again,
// after an edit, is measured again.
export class OfflineBandsCache {
  private measured: {
    mix: AudioMix;
    bands: Promise<OfflineAudioBands | null>;
  } | null = null;

  async at(
    {
      audioMix = SILENT_AUDIO_MIX,
      mediaItems,
    }: {
      audioMix?: AudioMix;
      mediaItems: Parameters<typeof renderAudioMixOffline>[1];
    },
    seconds: number,
  ) {
    if (this.measured?.mix !== audioMix) {
      this.measured = {
        mix: audioMix,
        bands: renderOfflineAudioBands(audioMix, mediaItems),
      };
    }
    return (await this.measured.bands)?.at(seconds) ?? SILENT_AUDIO_BANDS;
  }

  clear() {
    this.measured = null;
  }
}
