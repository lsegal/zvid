// Plays the audio mix in the preview. Each contributing clip plays its own
// audio element through Web Audio:
//
//   element → clip GainNode → master GainNode → limiter → analyser
//     → preview volume → speakers
//
// The analyser feeds audio-reactive effects (see LiveAudioBands), so they
// follow the mix after every Gain but not the preview volume. Elements are
// made shortly before their clip starts and released once it has passed,
// and follow the playhead as the compositor's video elements do.
import type { PreviewVolume } from "../app/preview-volume.ts";
import { clamp } from "../app/util.ts";
import { createBandAnalyser } from "../fx-shaders/audio-bands.ts";
import { releaseMediaElement } from "../media-element.ts";
import { clipMediaTimeAt, LIMITER_HEADROOM, limiterCurve } from "./mix.ts";
import { type AudioMix, type AudioMixClip, SILENT_AUDIO_MIX } from "./resolve.ts";

export type AudioMixPlayback = {
  playheadSeconds: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  isAudibleScrubbing: boolean;
  isContinuousScrubbing: boolean;
};

type Voice = {
  url: string;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

type MixGraph = {
  context: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  output: GainNode;
};

const MAX_DRIFT_SECONDS = 0.18;
const SCRUB_DRIFT_SECONDS = 0.035;
// Audio keeps playing through a scrub started during playback, so it only
// re-syncs once it falls this far behind or ahead of the playhead.
const CONTINUOUS_SCRUB_DRIFT_SECONDS = 0.1;
// A clip's element is made this long before the clip starts, so it has
// loaded by then, and released this long after it ends.
const PRELOAD_SECONDS = 1.5;
const RELEASE_SECONDS = 3;
// The playback rates every browser accepts; a media element throws outside
// them.
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;

export class PreviewAudioMixer {
  private graph: MixGraph | null = null;
  private voices = new Map<string, Voice>();
  private mix: AudioMix = SILENT_AUDIO_MIX;
  private urlById = new Map<string, string>();
  private volume: PreviewVolume = { volume: 1, muted: false };

  update(mix: AudioMix, mediaItems: readonly { id: string; previewUrl: string }[]) {
    this.mix = mix;
    this.urlById = new Map(
      mediaItems
        .filter((item) => item.previewUrl)
        .map((item) => [item.id, item.previewUrl]),
    );
    const clipById = new Map(mix.clips.map((clip) => [clip.id, clip]));
    for (const [clipId, voice] of this.voices) {
      const clip = clipById.get(clipId);
      if (!clip || this.urlOf(clip) !== voice.url) {
        this.release(clipId);
      } else {
        voice.gain.gain.value = clip.amplitude;
      }
    }
    if (this.graph) {
      this.graph.master.gain.value = mix.masterAmplitude;
    }
  }

  // The preview playback volume, after the analyser.
  setVolume(volume: PreviewVolume) {
    this.volume = volume;
    if (this.graph) {
      this.graph.output.gain.value = volume.muted ? 0 : volume.volume;
    }
  }

  // What audio-reactive effects measure, once the mix has played.
  get analyser() {
    return this.graph?.analyser ?? null;
  }

  sync(playback: AudioMixPlayback) {
    const shouldPlay = playback.isPlaying || playback.isAudibleScrubbing;
    const continuousScrub =
      playback.isAudibleScrubbing && playback.isContinuousScrubbing;
    const driftTolerance = continuousScrub
      ? CONTINUOUS_SCRUB_DRIFT_SECONDS
      : playback.isAudibleScrubbing
        ? SCRUB_DRIFT_SECONDS
        : MAX_DRIFT_SECONDS;
    const now = playback.playheadSeconds;

    for (const clip of this.mix.clips) {
      const start = clip.startSeconds;
      const end = clip.startSeconds + clip.durationSeconds;
      const nearby = now >= start - PRELOAD_SECONDS && now < end + RELEASE_SECONDS;
      if (!nearby) {
        this.release(clip.id);
        continue;
      }
      // A silent clip makes no element until its Gain is turned up.
      const voice =
        this.voices.get(clip.id) ??
        (clip.amplitude > 0 ? this.createVoice(clip) : undefined);
      if (!voice) {
        continue;
      }

      const at = clipMediaTimeAt(clip, now, this.mix.bpm);
      if (!at) {
        if (!voice.element.paused) {
          voice.element.pause();
        }
        // Waits at the clip's first sound, ready for it to start.
        const first = clipMediaTimeAt(clip, Math.max(now, start), this.mix.bpm);
        if (first && now < start) {
          seek(voice.element, first.mediaTime, driftTolerance);
        }
        continue;
      }

      const rate = clamp(at.playbackRate, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE);
      if (voice.element.playbackRate !== rate) {
        voice.element.playbackRate = rate;
      }
      seek(voice.element, at.mediaTime, shouldPlay ? driftTolerance : 0);
      if (shouldPlay) {
        voice.element.play().catch(() => {});
      } else if (!voice.element.paused) {
        voice.element.pause();
      }
    }

    if (shouldPlay) {
      this.resume();
    }
  }

  // Browsers start an AudioContext suspended until a user gesture, and the
  // mix stays silent until it resumes.
  resume() {
    if (this.graph?.context.state === "suspended") {
      this.graph.context.resume().catch(() => {});
    }
  }

  // Stops every clip, as when playback stops.
  pause() {
    for (const voice of this.voices.values()) {
      if (!voice.element.paused) {
        voice.element.pause();
      }
    }
  }

  dispose() {
    for (const clipId of [...this.voices.keys()]) {
      this.release(clipId);
    }
    this.graph?.context.close().catch(() => {});
    this.graph = null;
  }

  private urlOf(clip: AudioMixClip) {
    return this.urlById.get(clip.mediaId);
  }

  private ensureGraph() {
    if (this.graph) {
      return this.graph;
    }
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = this.mix.masterAmplitude;
    // The WaveShaper's curve spans −1..1, so the mix is scaled into it and
    // the curve scales it back (see limiterCurve).
    const headroom = context.createGain();
    headroom.gain.value = 1 / LIMITER_HEADROOM;
    const limiter = context.createWaveShaper();
    limiter.curve = limiterCurve();
    const analyser = createBandAnalyser(context);
    const output = context.createGain();
    output.gain.value = this.volume.muted ? 0 : this.volume.volume;
    master.connect(headroom);
    headroom.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(output);
    output.connect(context.destination);
    this.graph = { context, master, analyser, output };
    return this.graph;
  }

  private createVoice(clip: AudioMixClip) {
    const url = this.urlOf(clip);
    if (!url) {
      return undefined;
    }
    try {
      const graph = this.ensureGraph();
      const element = document.createElement("audio");
      element.crossOrigin = "anonymous";
      element.preload = "auto";
      element.src = url;
      // Routing through Web Audio is permanent; the element plays at full
      // volume into its clip's gain.
      const source = graph.context.createMediaElementSource(element);
      const gain = graph.context.createGain();
      gain.gain.value = clip.amplitude;
      source.connect(gain);
      gain.connect(graph.master);
      const voice = { url, element, source, gain };
      this.voices.set(clip.id, voice);
      return voice;
    } catch (error) {
      console.warn("The preview cannot play clip audio.", error);
      return undefined;
    }
  }

  private release(clipId: string) {
    const voice = this.voices.get(clipId);
    if (!voice) {
      return;
    }
    releaseMediaElement(voice.element);
    voice.source.disconnect();
    voice.gain.disconnect();
    this.voices.delete(clipId);
  }
}

function seek(element: HTMLMediaElement, mediaTime: number, tolerance: number) {
  if (Math.abs(element.currentTime - mediaTime) > tolerance) {
    element.currentTime = mediaTime;
  }
}
