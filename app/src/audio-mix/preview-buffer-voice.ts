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

// How long before its clip starts steady playback hands a voice its clip,
// so the voice starts it on the audio clock just as the clip starts. A
// voice started by the first sync after its clip starts, and stopped by the
// first after it ends, leaves a gap between back-to-back clips as long as
// that sync was late: up to a frame, 33 ms where WebKit runs at 30 fps, and
// more on a busy main thread (#1115).
const SCHEDULE_AHEAD_SECONDS = 0.5;

// Where a clip from `start` to `end` on the timeline is at timeline time
// `at`, as DecodedClipVoice.sync takes it, or undefined where it is silent.
// In steady playback it is negative shortly before the clip starts, and
// past the clip's end its buffer, which ends there, runs out on its own.
export function decodedClipSeconds(
  at: number,
  start: number,
  end: number,
  playing: boolean,
  steady: boolean,
) {
  if (!playing) {
    return undefined;
  }
  if (steady) {
    return at >= start - SCHEDULE_AHEAD_SECONDS ? at - start : undefined;
  }
  return at >= start && at < end ? at - start : undefined;
}

// A buffer plays on the audio clock, which the playhead, on the display's
// clock, can read a jump in for a frame where the audio thread runs late.
// Restarting the buffer is an audible gap, so steady playback restarts it
// only once it has been off for STEADY_DRIFT_SYNCS syncs in a row, and
// where buffers play by preference, as in WebKit, only past
// LENIENT_DRIFT_SECONDS, as media elements there do (see preview-player.ts).
const STEADY_DRIFT_SYNCS = 3;
// A source started at the audio clock's current time starts late, as the
// audio thread has already moved on (by a render quantum in WebKit), and
// plays that far behind the clock, over the next clip's start. In steady
// playback one starts this far ahead instead, at its clip time there.
const START_AHEAD_SECONDS = 0.05;
const LENIENT_DRIFT_SECONDS = 0.6;

// The audio clock time each timeline time plays at in steady playback,
// which a mixer's decoded voices share, so back-to-back clips meet sample
// for sample rather than each where the playhead read as it started.
export class DecodedVoiceClock {
  private anchor: { contextTime: number; timelineSeconds: number } | null =
    null;

  // The audio clock time `timelineSeconds` plays at, given the playhead
  // puts it at `contextTime`: as the clock has it, if within `tolerance`,
  // else at `contextTime`, where the clock then puts it.
  contextTimeOf(
    timelineSeconds: number,
    contextTime: number,
    tolerance: number,
  ) {
    if (this.anchor) {
      const at =
        this.anchor.contextTime +
        (timelineSeconds - this.anchor.timelineSeconds);
      if (Math.abs(at - contextTime) <= tolerance) {
        return at;
      }
    }
    this.anchor = { contextTime, timelineSeconds };
    return contextTime;
  }

  // Forgets where the timeline plays unless playback is `steady`: a stop or
  // a scrub moves it.
  holdWhile(steady: boolean) {
    if (!steady) {
      this.anchor = null;
    }
  }
}

export class DecodedClipVoice {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  // While playing: the audio clock time its clip's start plays at.
  private startsAt = 0;
  private disposed = false;
  // How many steady syncs in a row it has been off for.
  private drifting = 0;
  private readonly context: AudioContext;
  private readonly output: AudioNode;
  private readonly lenient: boolean;
  private readonly clock: DecodedVoiceClock | undefined;

  constructor(
    context: AudioContext,
    clip: AudioMixClip,
    url: string,
    bpm: number,
    output: AudioNode,
    lenient = false,
    clock?: DecodedVoiceClock,
  ) {
    this.context = context;
    this.output = output;
    this.lenient = lenient;
    this.clock = clock;
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

  // Plays from `clipSeconds` into the clip, or when it is negative, from
  // the clip's start that many seconds from now, unless already playing
  // within `tolerance` of it, or stops when `clipSeconds` is undefined. A
  // restart to meet the playhead counts as a re-sync, `steady` in plain
  // playback, which waits for drift to last. In steady playback its clip,
  // starting at `startSeconds` on the timeline, starts where the shared
  // clock puts it.
  sync(
    clipSeconds: number | undefined,
    tolerance: number,
    steady = false,
    startSeconds = 0,
  ) {
    if (clipSeconds === undefined || !this.buffer) {
      this.stop();
      return;
    }
    const now = this.context.currentTime;
    const limit =
      steady && this.lenient
        ? Math.max(tolerance, LENIENT_DRIFT_SECONDS)
        : tolerance;
    if (this.source) {
      const drift = now - this.startsAt - clipSeconds;
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
    // The audio clock time the clip's start plays at, and the soonest it
    // can start.
    const startsAt =
      steady && this.clock
        ? this.clock.contextTimeOf(startSeconds, now - clipSeconds, limit)
        : now - clipSeconds;
    const soonest = now + (steady ? START_AHEAD_SECONDS : 0);
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output);
    source.start(Math.max(soonest, startsAt), Math.max(0, soonest - startsAt));
    this.source = source;
    this.drifting = 0;
    this.startsAt = startsAt;
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
