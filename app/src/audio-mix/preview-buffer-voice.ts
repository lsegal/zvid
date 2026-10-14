// Plays a clip whose source stages read its media other than forwards (see
// AudioSourceStage), which a media element cannot: the preview decodes its
// media, renders the clip's span through the same ClipReader export reads
// it with, and plays that buffer from the clip's position under the
// playhead. Spans and decoded media are cached across voices, and rendered
// off the main thread (see clip-audio-cache.ts).
import { audioDiagnostics } from "./audio-diagnostics.ts";
import { sharedClipAudioCache } from "./clip-audio-cache.ts";
import { clipReadSeconds, type DecodedAudio } from "./mix.ts";
import { AUDIO_PROCESSORS } from "./processors.ts";
import type { AudioMixClip } from "./resolve.ts";
import { renderSynthClip } from "./synth.ts";
import type { PlaybackLoop } from "./voice-window.ts";

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

// Whether the preview must play `clip` from a decoded buffer: a MIDI clip,
// whose notes render into one (see synth.ts), or a clip whose source stages
// read its media other than forwards.
export function needsDecodedVoice(
  clip: AudioMixClip,
  registry = AUDIO_PROCESSORS,
) {
  return (
    clip.synth !== undefined || clipReadSeconds(clip, registry) !== undefined
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

// How a decoded voice plays on into a loop's next pass (see
// DecodedClipVoice.sync): its out marker, `atSeconds` on the timeline, plays
// `untilSeconds` from now, and from there the clip plays from `clipSeconds`
// into it, or when that is negative, from its start that much later; when
// undefined, it is silent there.
export type DecodedLoopWrap = {
  atSeconds: number;
  untilSeconds: number;
  clipSeconds: number | undefined;
};

// How a clip from `start` to `end` on the timeline plays on into `loop`'s
// next pass once `at` reaches the out marker, as DecodedClipVoice.sync takes
// it: only within SCHEDULE_AHEAD_SECONDS of the out marker, so the next
// pass starts on the audio clock just as the wrap does, rather than once the
// playhead has wrapped and the voice has drifted off for a few syncs.
export function decodedLoopWrap(
  at: number,
  start: number,
  end: number,
  loop: PlaybackLoop | null | undefined,
): DecodedLoopWrap | undefined {
  const untilSeconds = loop ? loop.endSeconds - at : 0;
  if (!loop || untilSeconds <= 0 || untilSeconds > SCHEDULE_AHEAD_SECONDS) {
    return undefined;
  }
  const clipSeconds = loop.startSeconds - start;
  const plays =
    start < loop.endSeconds &&
    end > loop.startSeconds &&
    clipSeconds >= -SCHEDULE_AHEAD_SECONDS;
  return {
    atSeconds: loop.endSeconds,
    untilSeconds,
    clipSeconds: plays ? clipSeconds : undefined,
  };
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

// What a clip's span is rendered from: everything but its gain, its bus and
// the parameters of stages that process its sound rather than read it.
function spanInputs(clip: AudioMixClip, bpm: number) {
  const { amplitude, hasGain, busId, effects, id, stages, ...read } = clip;
  const sources = stages.filter(
    (stage) => stage.enabled && AUDIO_PROCESSORS.get(stage.effectName)?.source,
  );
  return JSON.stringify([read, sources, bpm]);
}

// Where in `to`'s span the media plays that `from`'s plays `clipSeconds`
// into its own, both reading the same clip from the same start: source
// stages map timeline time linearly, so this solves `to`'s mapping for
// the timeline time `from` reads.
export function reanchoredClipSeconds(
  from: AudioMixClip,
  to: AudioMixClip,
  clipSeconds: number,
) {
  const start = to.startSeconds;
  const toRead = clipReadSeconds(to) ?? ((seconds) => seconds);
  const fromRead = clipReadSeconds(from) ?? ((seconds) => seconds);
  const slope = toRead(start + 1) - toRead(start);
  const read = fromRead(from.startSeconds + clipSeconds);
  return slope ? (read - toRead(start)) / slope : clipSeconds;
}

export class DecodedClipVoice {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  // The clip its buffer was rendered from, and the latest it was handed,
  // whose span renders under the latest of its render counts.
  private clip: AudioMixClip;
  private latest: AudioMixClip;
  private latestInputs: string | undefined;
  private renders = 0;
  private readonly url: string;
  private bpm: number;
  // How far its buffer plays ahead of the playhead, since its read mapping
  // changed while it played; a stop or a scrub puts it back on the
  // playhead.
  private shift = 0;
  // While playing: the audio clock time its buffer's start plays at.
  private startsAt = 0;
  private disposed = false;
  // How many steady syncs in a row it has been off for.
  private drifting = 0;
  // The loop's next pass, started ahead on the audio clock: its source,
  // if it plays there, takes over at `switchAt`, where the one playing now
  // is stopped.
  private next: {
    source: AudioBufferSourceNode | null;
    switchAt: number;
    clipSeconds: number | undefined;
  } | null = null;
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
    this.clip = clip;
    this.latest = clip;
    this.url = url;
    this.bpm = bpm;
    void this.load(clip, bpm);
  }

  // Renders `clip` again when what it reads changed, as when Re-Pitch's
  // pitch is turned while it plays, and plays on from the same place in
  // its media once that is rendered.
  retune(clip: AudioMixClip, bpm: number) {
    if (clip === this.latest) {
      return;
    }
    this.latestInputs ??= spanInputs(this.latest, this.bpm);
    const inputs = spanInputs(clip, bpm);
    this.latest = clip;
    if (inputs !== this.latestInputs) {
      this.latestInputs = inputs;
      this.bpm = bpm;
      void this.load(clip, bpm);
    }
  }

  // The span of `clip`'s media its buffer plays.
  protected renderSpan(clip: AudioMixClip, bpm: number) {
    const { context } = this;
    return sharedClipAudioCache().span(
      { clip, url: this.url, bpm, sampleRate: context.sampleRate },
      (mediaUrl) =>
        clip.synth
          ? renderSynthClip(clip.synth, bpm, context.sampleRate)
          : decodeClipMedia(context, mediaUrl),
    );
  }

  private async load(clip: AudioMixClip, bpm: number) {
    const render = ++this.renders;
    try {
      const { context } = this;
      const span = await this.renderSpan(clip, bpm);
      if (this.disposed || render !== this.renders) {
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
      this.swap(clip, buffer);
    } catch (error) {
      console.warn("The preview cannot play clip audio.", error);
    }
  }

  // Plays `buffer`, rendered from `clip`, in place of the old one, from
  // where the old one has reached in the media, if playing.
  private swap(clip: AudioMixClip, buffer: AudioBuffer) {
    // A next pass already started plays the old buffer, so it starts again.
    this.dropWrap();
    const playing = this.source !== null && this.buffer !== null;
    const now = this.context.currentTime;
    const from = this.clip;
    this.clip = clip;
    this.buffer = buffer;
    if (!playing || clip.startSeconds !== from.startSeconds) {
      if (playing) {
        this.stop();
      }
      return;
    }
    const at = now - this.startsAt;
    const anchored = at < 0 ? at : reanchoredClipSeconds(from, clip, at);
    this.shift += anchored - at;
    this.stop();
    this.play(now - anchored, now);
  }

  // Plays from `clipSeconds` into the clip, or when it is negative, from
  // the clip's start that many seconds from now, unless already playing
  // within `tolerance` of it, or stops when `clipSeconds` is undefined. A
  // restart to meet the playhead counts as a re-sync, `steady` in plain
  // playback, which waits for drift to last. In steady playback its clip,
  // starting at `startSeconds` on the timeline, starts where the shared
  // clock puts it, and with `wrap`, its next pass of the loop starts ahead,
  // just as the loop wraps.
  sync(
    clipSeconds: number | undefined,
    tolerance: number,
    steady = false,
    startSeconds = 0,
    wrap?: DecodedLoopWrap,
  ) {
    this.takeWrap();
    if (!steady || !wrap) {
      this.cancelWrap(!steady, tolerance);
    }
    this.follow(clipSeconds, tolerance, steady, startSeconds);
    if (steady && wrap) {
      this.startWrap(wrap, this.limit(tolerance, steady));
    }
  }

  private limit(tolerance: number, steady: boolean) {
    return steady && this.lenient
      ? Math.max(tolerance, LENIENT_DRIFT_SECONDS)
      : tolerance;
  }

  private follow(
    clipSeconds: number | undefined,
    tolerance: number,
    steady: boolean,
    startSeconds: number,
  ) {
    if (clipSeconds === undefined || !this.buffer) {
      this.shift = 0;
      this.stopSource();
      return;
    }
    if (!steady) {
      this.shift = 0;
    }
    const now = this.context.currentTime;
    const limit = this.limit(tolerance, steady);
    if (this.source) {
      const drift = now - this.startsAt - clipSeconds - this.shift;
      if (steady) {
        audioDiagnostics.recordDrift(drift);
      }
      this.drifting = Math.abs(drift) > limit ? this.drifting + 1 : 0;
      if (!this.drifting || (steady && this.drifting < STEADY_DRIFT_SYNCS)) {
        return;
      }
      audioDiagnostics.recordResync(steady);
      this.stopSource();
    }
    // The audio clock time the clip's start plays at, and the soonest it
    // can start.
    const startsAt =
      steady && this.clock && !this.shift
        ? this.clock.contextTimeOf(startSeconds, now - clipSeconds, limit)
        : now - clipSeconds - this.shift;
    this.play(startsAt, now + (steady ? START_AHEAD_SECONDS : 0));
  }

  // Starts its buffer at `startsAt` on the audio clock, from `soonest`.
  private play(startsAt: number, soonest: number) {
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.output);
    source.start(Math.max(soonest, startsAt), Math.max(0, soonest - startsAt));
    this.source = source;
    this.drifting = 0;
    this.startsAt = startsAt;
  }

  // Starts the loop's next pass `wrap.untilSeconds` from now, where the
  // shared clock puts the out marker, and stops the buffer playing now
  // there, unless the same pass has already started.
  private startWrap(wrap: DecodedLoopWrap, limit: number) {
    if (!this.buffer) {
      return;
    }
    const estimate = this.context.currentTime + wrap.untilSeconds;
    const switchAt = this.clock
      ? this.clock.contextTimeOf(wrap.atSeconds, estimate, limit)
      : estimate;
    // A pass about to start is left to, as when this one is the pass after
    // it, which a short loop asks for before the playhead has wrapped.
    const { next } = this;
    if (
      next &&
      ((next.clipSeconds === wrap.clipSeconds &&
        Math.abs(next.switchAt - switchAt) <= limit) ||
        this.context.currentTime >= next.switchAt - limit)
    ) {
      return;
    }
    this.cancelWrap(true);
    let source: AudioBufferSourceNode | null = null;
    if (wrap.clipSeconds !== undefined) {
      source = this.context.createBufferSource();
      source.buffer = this.buffer;
      source.connect(this.output);
      source.start(
        switchAt + Math.max(0, -wrap.clipSeconds),
        Math.max(0, wrap.clipSeconds),
      );
    }
    this.source?.stop(switchAt);
    this.next = { source, switchAt, clipSeconds: wrap.clipSeconds };
  }

  // Plays on from the loop's next pass once the audio clock reaches it.
  private takeWrap() {
    const { next } = this;
    if (!next || this.context.currentTime < next.switchAt) {
      return;
    }
    this.next = null;
    this.source?.disconnect();
    this.source = next.source;
    this.startsAt = next.switchAt - (next.clipSeconds ?? 0);
    this.shift = 0;
    this.drifting = 0;
  }

  // Drops the loop's next pass, unless, without `force`, it is due within
  // `tolerance`, as when the playhead wraps a moment before the audio clock.
  // The buffer playing now, stopped where the pass started, starts again.
  private cancelWrap(force: boolean, tolerance = 0) {
    const { next } = this;
    if (
      !next ||
      (!force && this.context.currentTime >= next.switchAt - tolerance)
    ) {
      return;
    }
    this.dropWrap();
    this.stopSource();
  }

  // Drops the loop's next pass, leaving the buffer playing now as it is.
  private dropWrap() {
    stopSource(this.next?.source ?? null);
    this.next = null;
  }

  private stopSource() {
    stopSource(this.source);
    this.source = null;
  }

  stop() {
    this.cancelWrap(true);
    this.stopSource();
  }

  dispose() {
    this.disposed = true;
    this.stop();
  }
}

function stopSource(source: AudioBufferSourceNode | null) {
  if (!source) {
    return;
  }
  try {
    source.stop();
  } catch {
    // Already ended.
  }
  source.disconnect();
}
