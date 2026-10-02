// Renders an audio mix offline, for export and for the audio bands export
// measures: each contributing media is decoded once at the render's sample
// rate, then mixed by renderAudioMix.
import {
  type AudioMixRenderOptions,
  type DecodedAudio,
  isAudibleMix,
  renderAudioMix,
} from "./mix.ts";
import type { AudioMix } from "./resolve.ts";

type MixMedia = { id: string; previewUrl: string };

async function decodeMedia(url: string, sampleRate: number) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot read clip audio (${response.status}).`);
  }
  // Decoding resamples to the context's rate, the render's sample rate.
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  return {
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel),
    ),
  } satisfies DecodedAudio;
}

// Renders `mix` over `options`, or returns null when nothing in it can make
// a sound. Media missing from `mediaItems`, or offline, stays silent.
export async function renderAudioMixOffline(
  mix: AudioMix,
  mediaItems: readonly MixMedia[],
  options: AudioMixRenderOptions,
) {
  if (!isAudibleMix(mix) || options.length <= 0) {
    return null;
  }
  const urlById = new Map(
    mediaItems.map((item) => [item.id, item.previewUrl] as const),
  );
  const mediaIds = new Set(
    mix.clips
      .filter((clip) => clip.amplitude > 0 && urlById.get(clip.mediaId))
      .map((clip) => clip.mediaId),
  );
  if (!mediaIds.size) {
    return null;
  }
  const decoded = new Map<string, DecodedAudio>();
  await Promise.all(
    [...mediaIds].map(async (mediaId) => {
      decoded.set(
        mediaId,
        await decodeMedia(urlById.get(mediaId) as string, options.sampleRate),
      );
    }),
  );
  return renderAudioMix(mix, decoded, options);
}
