// Which waveform a clip draws. Audio-only media draws its waveform in place
// of a filmstrip, like the Audio lane. Video with an audio track draws it
// semi-transparent over its frames. Everything else, including fill, text and
// FX clips and media that is not online, draws none.
import {
  type ClipMediaRef,
  type ClipMediaState,
  isGeneratedClip,
} from "./clip-media-state.ts";
import type { MediaItem } from "./media.ts";

export type ClipWaveformKind = "audio" | "overlay" | "none";

export function getClipWaveformKind(
  clip: ClipMediaRef,
  media: Pick<MediaItem, "hasAudio" | "hasVideo"> | undefined,
  mediaState: ClipMediaState,
): ClipWaveformKind {
  if (!media || isGeneratedClip(clip) || mediaState !== "online") {
    return "none";
  }
  if (!media.hasVideo) {
    return "audio";
  }
  return media.hasAudio ? "overlay" : "none";
}
