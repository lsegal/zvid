// Plays a clip whose source stages read its media other than forwards (see
// AudioSourceStage), which a media element cannot: the preview decodes its
// media, renders the clip's span through the same ClipReader export reads
// it with, and plays that buffer from the clip's position under the
// playhead. Spans and decoded media are cached across voices, and rendered
// off the main thread (see clip-audio-cache.ts).
import { audioDiagnostics } from "./audio-diagnostics.ts";
import { sharedClipAudioCache } from "./clip-audio-cache.ts";
import type { DecodedAudio } from "./mix.ts";
import type { AudioMixClip } from "./resolve.ts";

// The longest media, and clip, WebKit plays from a decoded buffer rather
// than a media element, bounding the memory decoding takes: a minute of
// 48 kHz stereo decodes to about 23 MB, and the clip's span as much again.
const MAX_PREFERRED_DECODED_SECONDS = 120;

// Whether the preview may play `clip`, an audio-only clip, from a decoded
// buffer by preference, as it does in WebKit (#1111). There an <audio>
// routed through a MediaElementAudioSourceNode stalls for up to a second
// after it starts playing, so the mixer's seek to catch it up stalls it
// again: steady playback re-seeks, audibly, several times every ten
// seconds. A buffer plays on the audio clock alone. Its media's length must
// be known and short enough.
export function prefersDecodedVoice(
  clip: Pick<AudioMixClip, "durationSeconds" | "mediaDurationSeconds">,
) {
  return (
    clip.mediaDurationSeconds !== undefined &&
    clip.mediaDurationSeconds <= MAX_PREFERRED_DECODED_SECONDS &&
    clip.durationSeconds <= MAX_PREFERRED_DECODED_SECONDS
  );
}

// The media at `url`, decoded at `context`'s rate into arrays of its own, so
// they can move to the clip span worker.
export async function decodeClipMedia(
  context: BaseAudioContext,
  url: string,
): Promise<DecodedAudio> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot read clip audio (${response.status}).`);
  }
  const decoded = await context.decodeAudioData(await response.arrayBuffer());
  return {
    sampleRate: decoded.sampleRate,
    channels: Array.from({ length: decoded.numberOfChannels }, (_, index) =>
      decoded.getChannelData(index).slice(),
    ),
  };
}

// A buffer plays on the audio clock, which the playhead, on the display's
// clock, can read a jump in for a frame where the audio thread runs late.
// Restarting the buffer is an audible gap, so steady playback restarts it
// only once it has been off for STEADY_DRIFT_SYNCS syncs in a row, and
// where buffers play by preference, as in WebKit, only past
// LENIENT_DRIFT_SECONDS, as media elements there do (see preview-player.ts).
const STEADY_DRIFT_SYNCS = 3;
const LENIENT_DRIFT_SECONDS = 0.6;

export class DecodedClipVoice {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  // While playing: the context time it started and the clip second it
  // started from.
  private started = { contextTime: 0, clipSeconds: 0 };
  private disposed = false;
  // How many steady syncs in a row it has been off for.
  private drifting = 0;
  private readonly context: AudioContext;
  private readonly output: AudioNode;
  private readonly lenient: boolean;

  constructor(
    context: AudioContext,
    clip: AudioMixClip,
    url: string,
    bpm: number,
    output: AudioNode,
    lenient = false,
  ) {
    this.context = context;
    this.output = output;
    this.lenient = lenient;
    void this.load(clip, url, bpm);
  }

  private async load(clip: AudioMixClip, url: string, bpm: number) {
    try {
      const { context } = this;
      const span = await sharedClipAudioCache().span(
        { clip, url, bpm, sampleRate: context.sampleRate },
        (mediaUrl) => decodeClipMedia(context, mediaUrl),
      );
      if (this.disposed) {
        return;
      }
      const buffer = context.createBuffer(
        span.length,
        span[0].length,
        context.sampleRate,
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
  // `tolerance` of it, or stops when `clipSeconds` is undefined. A restart
  // to meet the playhead counts as a re-sync, `steady` in plain playback,
  // which waits for drift to last.
  sync(clipSeconds: number | undefined, tolerance: number, steady = false) {
    if (clipSeconds === undefined || !this.buffer) {
      this.stop();
      return;
    }
    if (this.source) {
      const playing =
        this.started.clipSeconds +
        (this.context.currentTime - this.started.contextTime);
      const drift = playing - clipSeconds;
      const limit =
        steady && this.lenient
          ? Math.max(tolerance, LENIENT_DRIFT_SECONDS)
          : tolerance;
      if (steady) {
        audioDiagnostics.recordDrift(drift);
      }
      this.drifting = Math.abs(drift) > limit ? this.drifting + 1 : 0;
      if (!this.drifting || (steady && this.drifting < STEADY_DRIFT_SYNCS)) {
        return;
      }
      audioDiagnostics.recordResync(steady);
      this.stop();
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output);
    source.start(0, Math.max(0, clipSeconds));
    this.source = source;
    this.drifting = 0;
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
