// Plays the audio mix in the preview. Each contributing clip plays its own
// audio element through Web Audio. A mix of Gains alone, every session's
// before other audio effects, plays through native gains, which reproduce
// export exactly:
//
//   element → clip GainNode → master GainNode → limiter → analyser
//     → preview volume → speakers
//
// A mix with any other audio effect runs its chains in the chain worklet
// (see chain-worklet.ts), the same DSP export renders with (see mix.ts):
//
//   element → clip chain → track bus chain → master chain → master GainNode
//     → limiter → analyser → preview volume → speakers
//
// The analyser feeds audio-reactive effects (see LiveAudioBands), and the
// limiter also feeds the transport's VU meter, so both follow the mix after
// every Gain but not the preview volume. Elements are made shortly before
// their clip starts and released once it, and its chain's tail, has passed,
// and follow the playhead as the compositor's video elements do. A clip that
// starts while its own element is still loading or seeking takes over a
// loaded element of the same media that another clip has finished with, so
// back-to-back short clips keep playing on a slow main thread. A clip
// whose source stages read its media other than forwards plays from a
// decoded buffer instead (see preview-buffer-voice.ts).
import type { PreviewVolume } from "../app/preview-volume.ts";
import { clamp } from "../app/util.ts";
import { loopMediaTime } from "../clip-warp.ts";
import {
  createBandAnalyser,
  createMeterTap,
  type MasterMeterTap,
} from "../fx-shaders/audio-bands.ts";
import { releaseMediaElement } from "../media-element.ts";
import { type AudioChainSettings, PARAMETER_RAMP_SECONDS } from "./chain.ts";
import {
  type ChainMessage,
  type ChainReport,
  type ChainTransport,
  createChainNode,
  postChainMessage,
} from "./chain-node.ts";
import {
  type AudioMixTiming,
  audioMixTempo,
  audioMixTiming,
  clipMediaTimeAt,
  clipReadSeconds,
  LIMITER_HEADROOM,
  limiterCurve,
} from "./mix.ts";
import { DecodedClipVoice } from "./preview-buffer-voice.ts";
import type { AudioProcessorRegistry } from "./processor.ts";
import { AUDIO_PROCESSORS } from "./processors.ts";
import {
  type AudioMix,
  type AudioMixClip,
  SILENT_AUDIO_MIX,
} from "./resolve.ts";
import { hasProcessingStages } from "./stages.ts";
import {
  receiveTransientReport,
  subscribeWatchedTransients,
  watchedTransients,
} from "./transient-monitor.ts";

export type AudioMixPlayback = {
  playheadSeconds: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  isAudibleScrubbing: boolean;
  isContinuousScrubbing: boolean;
};

export type PreviewAudioMixerOptions = {
  // The chain worklet's URL (see chain-worklet-url.ts). Without it, or
  // where the browser has no AudioWorklet, the preview plays Gain alone.
  workletUrl?: string;
  registry?: AudioProcessorRegistry;
};

// A media element routed into Web Audio. Voices of the same media trade
// players, so its source moves to whichever voice's gain it plays for.
type Player = {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  // The audio clock time its seek during playback was made, until it lands.
  seekStartedAt: number | null;
};

type Voice = {
  url: string;
  // Its media element, or for a clip read other than forwards, its decoded
  // buffer.
  player: Player | null;
  decoded: DecodedClipVoice | null;
  gain: GainNode;
  // Its clip chain, when the mix runs in the worklet.
  chain: AudioWorkletNode | null;
};

type MixGraph = {
  context: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  meter: MasterMeterTap;
  output: GainNode;
};

// The worklet nodes of a mix that runs its chains.
type ChainGraph = {
  master: AudioWorkletNode;
  buses: Map<string, AudioWorkletNode>;
};

const MAX_DRIFT_SECONDS = 0.18;
const SCRUB_DRIFT_SECONDS = 0.035;
// Audio keeps playing through a scrub started during playback, so it only
// re-syncs once it falls this far behind or ahead of the playhead.
const CONTINUOUS_SCRUB_DRIFT_SECONDS = 0.1;
// A clip's element is made this long before the clip starts, so it has
// loaded by then, and released this long after it ends, or after its
// chain's tail when that is longer.
const PRELOAD_SECONDS = 1.5;
// A clip read other than forwards decodes its media and renders its span
// before it can play, so its voice is made this much earlier.
const DECODED_PRELOAD_SECONDS = 8;
const RELEASE_SECONDS = 3;
// The playback rates every browser accepts; a media element throws outside
// them.
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;
// A playhead this far from where the chains expect it is a seek, which
// resets them so no stale tail plays; a smaller gap only re-anchors their
// timeline time.
const SEEK_SECONDS = 0.25;
const TRANSPORT_DRIFT_SECONDS = 0.02;
// The most a seek during playback aims ahead of the playhead to make up for
// how long seeks take to land.
const MAX_SEEK_LEAD_SECONDS = 0.5;
// HTMLMediaElement.HAVE_FUTURE_DATA: an element with this much can play.
const HAVE_FUTURE_DATA = 3;

// Whether `element` can play from where it is without waiting.
function isReady(element: HTMLMediaElement) {
  return element.readyState >= HAVE_FUTURE_DATA && !element.seeking;
}

// Sets `param` to `value`, ramping where the browser can so a live edit
// never clicks.
function setSmoothly(param: AudioParam, value: number, context: AudioContext) {
  if (typeof param.setTargetAtTime !== "function") {
    param.value = value;
    return;
  }
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, PARAMETER_RAMP_SECONDS / 3);
}

export class PreviewAudioMixer {
  private graph: MixGraph | null = null;
  private chains: ChainGraph | null = null;
  private voices = new Map<string, Voice>();
  private mix: AudioMix = SILENT_AUDIO_MIX;
  private urlById = new Map<string, string>();
  private volume: PreviewVolume = { volume: 1, muted: false };
  private readonly workletUrl: string | undefined;
  private readonly registry: AudioProcessorRegistry;
  private worklet: "idle" | "loading" | "ready" | "failed" = "idle";
  private timing: AudioMixTiming | null = null;
  private transport: ChainTransport | null = null;
  // Each chain node's settings as last posted, to skip repeats.
  private posted = new WeakMap<AudioWorkletNode, string>();
  // How long the last seek during playback took to land, by the audio clock.
  private seekLatency = 0;
  // Tells the chains which stages' Transient levels to report.
  private readonly unwatch: () => void;

  constructor(options: PreviewAudioMixerOptions = {}) {
    this.workletUrl = options.workletUrl;
    this.registry = options.registry ?? AUDIO_PROCESSORS;
    this.unwatch = subscribeWatchedTransients(() => {
      this.broadcast({ type: "watch", ids: watchedTransients() });
    });
  }

  update(
    mix: AudioMix,
    mediaItems: readonly { id: string; previewUrl: string }[],
  ) {
    this.mix = mix;
    this.urlById = new Map(
      mediaItems
        .filter((item) => item.previewUrl)
        .map((item) => [item.id, item.previewUrl]),
    );
    this.timing = this.graph
      ? audioMixTiming(mix, this.graph.context.sampleRate, this.registry)
      : null;
    this.applyMode();
    const clipById = new Map(mix.clips.map((clip) => [clip.id, clip]));
    for (const [clipId, voice] of this.voices) {
      const clip = clipById.get(clipId);
      if (
        !clip ||
        this.urlOf(clip) !== voice.url ||
        this.needsDecoded(clip) !== Boolean(voice.decoded)
      ) {
        this.release(clipId);
      } else if (voice.chain) {
        this.configure(voice.chain, this.clipSettings(clip));
      } else if (this.graph) {
        setSmoothly(voice.gain.gain, clip.amplitude, this.graph.context);
      }
    }
    if (this.chains) {
      this.configureChains(this.chains);
    } else if (this.graph) {
      setSmoothly(
        this.graph.master.gain,
        mix.masterAmplitude,
        this.graph.context,
      );
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

  // What the transport's VU meter reads, once the mix has played.
  get meterTap() {
    return this.graph?.meter ?? null;
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
    // Plain playback, as opposed to a scrub, lets seeks land and leads them.
    const steady = playback.isPlaying && !playback.isScrubbing;
    const now = playback.playheadSeconds;
    this.applyMode();
    // With chains, the mix comes out this late, so its media plays this far
    // ahead of the playhead to stay with the video, and the chains are told
    // the timeline time of what they are fed, as export tells them.
    const ahead =
      this.chains && this.graph && this.timing
        ? this.timing.latencyFrames / this.graph.context.sampleRate
        : 0;
    this.syncTransport(now + ahead, shouldPlay);
    const linger = Math.max(
      RELEASE_SECONDS,
      this.chains ? (this.timing?.tailSeconds ?? 0) : 0,
    );

    const clipById = new Map(this.mix.clips.map((clip) => [clip.id, clip]));
    for (const clip of this.mix.clips) {
      const start = clip.startSeconds;
      const end = clip.startSeconds + clip.durationSeconds;
      const preload = this.needsDecoded(clip)
        ? DECODED_PRELOAD_SECONDS
        : PRELOAD_SECONDS;
      const nearby = now >= start - preload && now < end + linger;
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
      const at = now + ahead;

      if (voice.decoded) {
        const inside = at >= start && at < end;
        voice.decoded.sync(
          shouldPlay && inside ? at - start : undefined,
          driftTolerance,
        );
        continue;
      }
      const media = clipMediaTimeAt(clip, at, this.mix.bpm);
      if (media) {
        this.takeReadyPlayer(
          voice,
          media.mediaTime,
          driftTolerance,
          at,
          clipById,
        );
      }
      const player = voice.player as Player;
      const { element } = player;
      if (!media) {
        if (!element.paused) {
          element.pause();
        }
        // Waits at the clip's first sound, ready for it to start.
        const first = clipMediaTimeAt(clip, Math.max(at, start), this.mix.bpm);
        if (first && at < start) {
          this.seek(player, first.mediaTime, driftTolerance, false, 0);
        }
        continue;
      }

      const rate = clamp(
        media.playbackRate,
        MIN_PLAYBACK_RATE,
        MAX_PLAYBACK_RATE,
      );
      if (element.playbackRate !== rate) {
        element.playbackRate = rate;
      }
      this.seek(
        player,
        media.mediaTime,
        shouldPlay ? driftTolerance : 0,
        steady,
        clip.mediaDurationSeconds ?? 0,
      );
      if (shouldPlay) {
        element.play().catch(() => {});
      } else if (!element.paused) {
        element.pause();
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

  // Stops every clip, as when playback stops. Chains keep running, so
  // their tails fade out.
  pause() {
    for (const voice of this.voices.values()) {
      if (voice.player && !voice.player.element.paused) {
        voice.player.element.pause();
      }
      voice.decoded?.stop();
    }
    if (this.transport && this.graph) {
      this.syncTransport(this.timelineNow(this.transport), false);
    }
  }

  dispose() {
    this.unwatch();
    this.teardownChains();
    this.graph?.context.close().catch(() => {});
    this.graph = null;
  }

  private urlOf(clip: AudioMixClip) {
    return this.urlById.get(clip.mediaId);
  }

  private needsDecoded(clip: AudioMixClip) {
    return clipReadSeconds(clip, this.registry) !== undefined;
  }

  // Whether the mix needs its chains run, beyond Gain.
  private mixNeedsChains() {
    const { registry } = this;
    return (
      hasProcessingStages(registry, this.mix.master) ||
      this.mix.buses.some((bus) => hasProcessingStages(registry, bus.stages)) ||
      this.mix.clips.some((clip) => hasProcessingStages(registry, clip.stages))
    );
  }

  // Runs the mix in the worklet when it needs chains and the worklet has
  // loaded, else through native gains, rebuilding the voices on a change.
  // While the worklet loads, a mix that needs it makes no voices.
  private applyMode() {
    const wantsChains = this.mixNeedsChains() && this.worklet !== "failed";
    if (wantsChains && this.worklet === "idle" && this.graph) {
      this.loadWorklet(this.graph.context);
    }
    const chained = wantsChains && this.worklet === "ready";
    if (chained === Boolean(this.chains)) {
      return;
    }
    this.teardownChains();
    if (chained && this.graph) {
      const master = this.chainNode(this.graph.context, this.masterSettings());
      master.connect(this.graph.master);
      this.graph.master.gain.value = 1;
      this.chains = { master, buses: new Map() };
    } else if (this.graph) {
      this.graph.master.gain.value = this.mix.masterAmplitude;
    }
  }

  private loadWorklet(context: AudioContext) {
    if (!this.workletUrl || !context.audioWorklet) {
      this.worklet = "failed";
      return;
    }
    this.worklet = "loading";
    context.audioWorklet.addModule(this.workletUrl).then(
      () => {
        this.worklet = "ready";
        this.applyMode();
      },
      (error) => {
        console.warn("The preview plays audio without its effects.", error);
        this.worklet = "failed";
        this.applyMode();
      },
    );
  }

  // Releases every voice and the chain nodes; the next sync makes the
  // voices again.
  private teardownChains() {
    for (const clipId of [...this.voices.keys()]) {
      this.release(clipId);
    }
    if (this.chains) {
      for (const bus of this.chains.buses.values()) {
        bus.disconnect();
      }
      this.chains.master.disconnect();
      this.chains = null;
    }
    this.transport = null;
  }

  private chainNodes() {
    const nodes: AudioWorkletNode[] = [];
    if (this.chains) {
      nodes.push(this.chains.master, ...this.chains.buses.values());
    }
    for (const voice of this.voices.values()) {
      if (voice.chain) {
        nodes.push(voice.chain);
      }
    }
    return nodes;
  }

  private broadcast(message: ChainMessage) {
    for (const node of this.chainNodes()) {
      postChainMessage(node, message);
    }
  }

  private timelineNow(transport: ChainTransport) {
    const context = this.graph?.context;
    return context
      ? transport.timelineSeconds +
          (context.currentTime - transport.contextTime) * transport.rate
      : transport.timelineSeconds;
  }

  // Tells the chains where the timeline is when that changes: on play,
  // pause or drift. A seek also resets them.
  private syncTransport(now: number, playing: boolean) {
    const context = this.graph?.context;
    if (!this.chains || !context) {
      return;
    }
    const rate = playing ? 1 : 0;
    const previous = this.transport;
    const gap = previous ? Math.abs(this.timelineNow(previous) - now) : 0;
    if (previous && previous.rate === rate && gap <= TRANSPORT_DRIFT_SECONDS) {
      return;
    }
    if (previous && gap > SEEK_SECONDS) {
      this.broadcast({ type: "reset" });
    }
    this.transport = {
      contextTime: context.currentTime,
      timelineSeconds: now,
      rate,
    };
    this.broadcast({ type: "transport", ...this.transport });
  }

  // A chain node starting with `settings` at the current transport.
  private chainNode(context: AudioContext, settings: AudioChainSettings) {
    const node = createChainNode(context, {
      settings,
      tempo: audioMixTempo(this.mix),
      ...(this.transport ? { transport: this.transport } : {}),
      watch: watchedTransients(),
    });
    node.port.onmessage = (event: MessageEvent<ChainReport>) => {
      receiveTransientReport(event.data);
    };
    this.posted.set(node, JSON.stringify(settings));
    return node;
  }

  private configure(node: AudioWorkletNode, settings: AudioChainSettings) {
    const key = JSON.stringify(settings);
    if (this.posted.get(node) === key) {
      return;
    }
    this.posted.set(node, key);
    postChainMessage(node, {
      type: "configure",
      settings,
      tempo: audioMixTempo(this.mix),
    });
  }

  private clipSettings(clip: AudioMixClip): AudioChainSettings {
    return {
      stages: clip.stages,
      inputGain: clip.hasGain ? 1 : 0,
      delayFrames: this.timing?.clipDelayFrames.get(clip.id) ?? 0,
    };
  }

  private masterSettings(): AudioChainSettings {
    return { stages: this.mix.master, inputGain: 1, delayFrames: 0 };
  }

  private busSettings(busId: string): AudioChainSettings {
    const bus = this.mix.buses.find((candidate) => candidate.id === busId);
    return { stages: bus?.stages ?? [], inputGain: 1, delayFrames: 0 };
  }

  // Configures the master and bus chains for the mix, dropping buses it no
  // longer has.
  private configureChains(chains: ChainGraph) {
    this.configure(chains.master, this.masterSettings());
    const busIds = new Set(this.mix.buses.map((bus) => bus.id));
    for (const [busId, node] of chains.buses) {
      if (busIds.has(busId)) {
        this.configure(node, this.busSettings(busId));
      } else {
        node.disconnect();
        chains.buses.delete(busId);
      }
    }
  }

  private busNode(chains: ChainGraph, context: AudioContext, busId: string) {
    let node = chains.buses.get(busId);
    if (!node) {
      node = this.chainNode(context, this.busSettings(busId));
      node.connect(chains.master);
      chains.buses.set(busId, node);
    }
    return node;
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
    const meter = createMeterTap(context);
    const analyser = createBandAnalyser(context);
    const output = context.createGain();
    output.gain.value = this.volume.muted ? 0 : this.volume.volume;
    master.connect(headroom);
    headroom.connect(limiter);
    limiter.connect(meter.input);
    limiter.connect(analyser);
    analyser.connect(output);
    output.connect(context.destination);
    this.graph = { context, master, analyser, meter: meter.tap, output };
    this.timing = audioMixTiming(this.mix, context.sampleRate, this.registry);
    this.applyMode();
    return this.graph;
  }

  private createVoice(clip: AudioMixClip) {
    const url = this.urlOf(clip);
    if (!url) {
      return undefined;
    }
    try {
      const graph = this.ensureGraph();
      if (this.mixNeedsChains() && this.worklet === "loading") {
        return undefined;
      }
      const { context } = graph;
      const gain = context.createGain();
      let chain: AudioWorkletNode | null = null;
      if (this.chains) {
        chain = this.chainNode(context, this.clipSettings(clip));
        gain.connect(chain);
        chain.connect(this.busNode(this.chains, context, clip.busId));
      } else {
        gain.gain.value = clip.amplitude;
        gain.connect(graph.master);
      }

      const voice: Voice = {
        url,
        player: null,
        decoded: null,
        gain,
        chain,
      };
      if (this.needsDecoded(clip)) {
        voice.decoded = new DecodedClipVoice(
          context,
          clip,
          url,
          this.mix.bpm,
          gain,
        );
      } else {
        voice.player = this.createPlayer(context, url);
        voice.player.source.connect(gain);
      }
      this.voices.set(clip.id, voice);
      return voice;
    } catch (error) {
      console.warn("The preview cannot play clip audio.", error);
      return undefined;
    }
  }

  private createPlayer(context: AudioContext, url: string): Player {
    const element = document.createElement("audio");
    element.crossOrigin = "anonymous";
    element.preload = "auto";
    element.src = url;
    // Routing through Web Audio is permanent; the element plays at full
    // volume into its voice's gain.
    const source = context.createMediaElementSource(element);
    const player: Player = { element, source, seekStartedAt: null };
    element.addEventListener("seeked", () => {
      if (player.seekStartedAt !== null) {
        this.seekLatency = clamp(
          context.currentTime - player.seekStartedAt,
          0,
          MAX_SEEK_LEAD_SECONDS,
        );
        player.seekStartedAt = null;
      }
    });
    return player;
  }

  // Gives `voice`, whose clip plays `mediaTime` now, a ready player of the
  // same media from a voice whose clip is not playing at `at`, when its own
  // would have to load or seek first: preferably one already there, as the
  // previous clip's is when back-to-back clips play on through the media,
  // else, when its own has not loaded, any ready one, which seeks faster
  // than a fresh one loads. The
  // voices trade players, so the other keeps one for when it plays again.
  private takeReadyPlayer(
    voice: Voice,
    mediaTime: number,
    tolerance: number,
    at: number,
    clipById: Map<string, AudioMixClip>,
  ) {
    const own = voice.player;
    if (!own) {
      return;
    }
    const near = (player: Player) =>
      Math.abs(player.element.currentTime - mediaTime) <= tolerance;
    if (isReady(own.element) && near(own)) {
      return;
    }
    const ownLoaded = own.element.readyState >= HAVE_FUTURE_DATA;
    let best: Voice | null = null;
    for (const [otherId, other] of this.voices) {
      const candidate = other.player;
      const otherClip = clipById.get(otherId);
      if (
        other === voice ||
        !candidate ||
        other.url !== voice.url ||
        !isReady(candidate.element) ||
        (otherClip && clipMediaTimeAt(otherClip, at, this.mix.bpm))
      ) {
        continue;
      }
      if (near(candidate)) {
        best = other;
        break;
      }
      if (!ownLoaded && !best) {
        best = other;
      }
    }
    if (!best?.player) {
      return;
    }
    const taken = best.player;
    own.source.disconnect();
    taken.source.disconnect();
    own.source.connect(best.gain);
    taken.source.connect(voice.gain);
    if (!own.element.paused) {
      own.element.pause();
    }
    best.player = own;
    voice.player = taken;
  }

  private release(clipId: string) {
    const voice = this.voices.get(clipId);
    if (!voice) {
      return;
    }
    if (voice.player) {
      releaseMediaElement(voice.player.element);
      voice.player.source.disconnect();
    }
    voice.decoded?.dispose();
    voice.gain.disconnect();
    voice.chain?.disconnect();
    this.voices.delete(clipId);
  }

  // Seeks `voice`'s element to `mediaTime` once it drifts further than
  // `tolerance`. In `steady` playback a seek still landing is left to land,
  // and a new one aims as far ahead as the last one took to land, so an
  // element that starts late, as on a slow main thread, meets the playhead
  // rather than chasing it from behind. Aiming past the end of media
  // `mediaDurationSeconds` long loops back to its start, as the clip does.
  private seek(
    player: Player,
    mediaTime: number,
    tolerance: number,
    steady: boolean,
    mediaDurationSeconds: number,
  ) {
    const { element } = player;
    if (steady && element.seeking) {
      return;
    }
    if (Math.abs(element.currentTime - mediaTime) <= tolerance) {
      return;
    }
    const context = this.graph?.context;
    if (!steady || !context) {
      element.currentTime = mediaTime;
      player.seekStartedAt = null;
      return;
    }
    element.currentTime = loopMediaTime(
      mediaTime + this.seekLatency * element.playbackRate,
      mediaDurationSeconds,
    );
    player.seekStartedAt = context.currentTime;
  }
}
