// Plays a clip whose source stages read its media other than forwards (see
// AudioSourceStage), which a media element cannot: the preview decodes its
// media, renders the clip's span through the same ClipReader export reads
// it with, and plays that buffer from the clip's position under the
// playhead.
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

export class DecodedClipVoice {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  // While playing: the context time it started and the clip second it
  // started from.
  private started = { contextTime: 0, clipSeconds: 0 };
  private disposed = false;
  private readonly context: AudioContext;
  private readonly output: AudioNode;

  constructor(
    context: AudioContext,
    clip: AudioMixClip,
    url: string,
    bpm: number,
    output: AudioNode,
  ) {
    this.context = context;
    this.output = output;
    void this.load(clip, url, bpm);
  }

  private async load(clip: AudioMixClip, url: string, bpm: number) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Cannot read clip audio (${response.status}).`);
      }
      const decoded = await this.context.decodeAudioData(
        await response.arrayBuffer(),
      );
      if (this.disposed) {
        return;
      }
      const media = {
        sampleRate: decoded.sampleRate,
        channels: Array.from({ length: decoded.numberOfChannels }, (_, index) =>
          decoded.getChannelData(index),
        ),
      };
      const channels = Math.max(1, decoded.numberOfChannels);
      const span = renderClipSpan(
        clip,
        media,
        bpm,
        this.context.sampleRate,
        channels,
      );
      const buffer = this.context.createBuffer(
        channels,
        span[0].length,
        this.context.sampleRate,
      );
      span.forEach((data, channel) => {
        buffer.copyToChannel(data, channel);
      });
      this.buffer = buffer;
    } catch (error) {
      console.warn("The preview cannot play clip audio.", error);
    }
  }

  // Plays from `clipSeconds` into the clip, unless already playing within
  // `tolerance` of it, or stops when `clipSeconds` is undefined.
  sync(clipSeconds: number | undefined, tolerance: number) {
    if (clipSeconds === undefined || !this.buffer) {
      this.stop();
      return;
    }
    if (this.source) {
      const playing =
        this.started.clipSeconds +
        (this.context.currentTime - this.started.contextTime);
      if (Math.abs(playing - clipSeconds) <= tolerance) {
        return;
      }
      this.stop();
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output);
    source.start(0, Math.max(0, clipSeconds));
    this.source = source;
    this.started = {
      contextTime: this.context.currentTime,
      clipSeconds,
    };
  }

  stop() {
    if (!this.source) {
      return;
    }
    try {
      this.source.stop();
    } catch {
      // Already ended.
    }
    this.source.disconnect();
    this.source = null;
  }

  dispose() {
    this.disposed = true;
    this.stop();
  }
}
