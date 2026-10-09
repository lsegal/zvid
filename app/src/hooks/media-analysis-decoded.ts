// A decoded copy of a media element's audio, for analysis only: it plays
// the decoded media into a meter tap in step with the element's play,
// pause, seeks and rate. It is for media a hidden routed copy can't follow
// in WebKit (see MediaAnalysisMirror): WebKit plays routed WebM silently
// (#1113) and routes nothing from 8 kHz media, but decodeAudioData reads
// both, resampled to the context's rate. Like the mirror it is never
// connected to the speakers. A buffer plays at the element's rate without
// keeping its pitch, so at other rates the spectrogram shifts with it.

import { MIRROR_MAX_DRIFT_SECONDS } from "./media-analysis-mirror.ts";

// The parts of a media element the follower reads, so tests can stand one
// in.
export type FollowedElement = Pick<
  HTMLMediaElement,
  | "currentSrc"
  | "currentTime"
  | "paused"
  | "playbackRate"
  | "addEventListener"
  | "removeEventListener"
>;

export type FollowerContext = Pick<
  BaseAudioContext,
  "currentTime" | "createBufferSource"
>;

const FOLLOWED_EVENTS = [
  "play",
  "pause",
  "seeking",
  "ratechange",
  "timeupdate",
  "loadstart",
] as const;

// Events after which the buffer restarts where the element is, rather than
// only once it has drifted.
const RESTART_EVENTS = new Set(["play", "seeking", "ratechange"]);

export class MediaAnalysisDecodedFollower {
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  // While playing: the context time it started, from where in the media,
  // at what rate.
  private startedAt = 0;
  private startOffset = 0;
  private rate = 1;
  private loadedSrc = "";
  private disposed = false;
  private readonly element: FollowedElement;
  private readonly context: FollowerContext;
  private readonly output: AudioNode;
  private readonly decode: (url: string) => Promise<AudioBuffer>;
  private readonly follow = (event: Event) => this.sync(event.type);

  constructor(
    element: FollowedElement,
    context: FollowerContext,
    output: AudioNode,
    decode: (url: string) => Promise<AudioBuffer>,
  ) {
    this.element = element;
    this.context = context;
    this.output = output;
    this.decode = decode;
    for (const type of FOLLOWED_EVENTS) {
      element.addEventListener(type, this.follow);
    }
    if (element.currentSrc) {
      this.load(element.currentSrc);
    }
  }

  private load(url: string) {
    this.loadedSrc = url;
    this.buffer = null;
    this.stop();
    this.decode(url).then(
      (buffer) => {
        if (!this.disposed && this.loadedSrc === url) {
          this.buffer = buffer;
          this.sync("seeking");
        }
      },
      (error) => {
        console.warn("The audio analysis cannot decode the media.", error);
      },
    );
  }

  // Where in the media the buffer is playing.
  private position() {
    return (
      this.startOffset + (this.context.currentTime - this.startedAt) * this.rate
    );
  }

  // Brings the buffer in line with the element after one of its events.
  private sync(type: string) {
    const { element } = this;
    if (
      type === "loadstart" &&
      element.currentSrc &&
      element.currentSrc !== this.loadedSrc
    ) {
      this.load(element.currentSrc);
      return;
    }
    if (!this.buffer || element.paused) {
      this.stop();
      return;
    }
    if (
      this.source &&
      !RESTART_EVENTS.has(type) &&
      Math.abs(this.position() - element.currentTime) <=
        MIRROR_MAX_DRIFT_SECONDS
    ) {
      return;
    }
    this.start(this.buffer);
  }

  private start(buffer: AudioBuffer) {
    this.stop();
    const offset = Math.max(0, this.element.currentTime);
    if (offset >= buffer.duration) {
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.element.playbackRate;
    source.connect(this.output);
    source.start(0, offset);
    this.source = source;
    this.startedAt = this.context.currentTime;
    this.startOffset = offset;
    this.rate = this.element.playbackRate;
  }

  private stop() {
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
    for (const type of FOLLOWED_EVENTS) {
      this.element.removeEventListener(type, this.follow);
    }
    this.stop();
    this.buffer = null;
  }
}
