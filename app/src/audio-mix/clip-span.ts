// Renders a clip's span as export reads it, from decoded media held under a
// key. Both the clip span worker and its main-thread fallback use this, so
// they render the same samples.
import { BLOCK_FRAMES, createBuffers } from "./chain.ts";
import { ClipReader, type DecodedAudio } from "./mix.ts";
import type { AudioMixClip } from "./resolve.ts";

// The clip's span read as export reads it, starting at its start.
export function renderClipSpan(
  clip: AudioMixClip,
  media: DecodedAudio,
  bpm: number,
  sampleRate: number,
  channels: number,
) {
  const length = Math.max(1, Math.ceil(clip.durationSeconds * sampleRate));
  const reader = new ClipReader(
    clip,
    media,
    bpm,
    sampleRate,
    clip.startSeconds,
  );
  const span = createBuffers(channels, length);
  const block = createBuffers(channels, BLOCK_FRAMES);
  for (let start = 0; start < length; start += BLOCK_FRAMES) {
    const frames = Math.min(BLOCK_FRAMES, length - start);
    reader.read(block, start, frames);
    for (let channel = 0; channel < channels; channel++) {
      span[channel].set(block[channel].subarray(0, frames), start);
    }
  }
  return span;
}

export type ClipSpanRequest = {
  clip: AudioMixClip;
  bpm: number;
  sampleRate: number;
};

export function audioBytes(channels: readonly Float32Array[]) {
  return channels.reduce((total, channel) => total + channel.byteLength, 0);
}

// Values under string keys, the least recently used dropped once their
// sizes add up past `maxBytes`. The newest value always stays, however big.
export class BoundedCache<Value> {
  private readonly entries = new Map<string, { value: Value; bytes: number }>();
  private bytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: Value, bytes: number) {
    this.delete(key);
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    for (const [oldest, entry] of this.entries) {
      if (this.bytes <= this.maxBytes || oldest === key) {
        break;
      }
      this.entries.delete(oldest);
      this.bytes -= entry.bytes;
    }
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
  }
}

// Decoded media under keys, rendering clip spans from it. A render of media
// it no longer holds returns undefined, so the caller hands it the media
// again.
export class ClipSpanRenderer {
  private readonly media: BoundedCache<DecodedAudio>;

  constructor(maxMediaBytes: number) {
    this.media = new BoundedCache(maxMediaBytes);
  }

  store(key: string, media: DecodedAudio) {
    this.media.set(key, media, audioBytes(media.channels));
  }

  render(key: string, { clip, bpm, sampleRate }: ClipSpanRequest) {
    const media = this.media.get(key);
    if (!media) {
      return undefined;
    }
    return renderClipSpan(
      clip,
      media,
      bpm,
      sampleRate,
      Math.max(1, media.channels.length),
    );
  }
}
