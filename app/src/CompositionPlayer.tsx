import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { CHAIN_WORKLET_URL } from "./audio-mix/chain-worklet-url.ts";
import { audioMixEndSeconds } from "./audio-mix/mix.ts";
import { renderAudioMixOffline } from "./audio-mix/offline.ts";
import { PreviewAudioMixer } from "./audio-mix/preview-mixer.ts";
import { type AudioMix, SILENT_AUDIO_MIX } from "./audio-mix/resolve.ts";
import {
  type ActiveClip,
  type ArrangementClip,
  computeActiveClips,
  effectUsesAudio,
  GROUP_TRACK_ID,
  type Lane,
  liveBandsAnalyser,
  type MediaItem,
  quartersToSeconds,
  resolveAnimatedOrder,
  resolveFrameEffects,
  type SessionEffect,
} from "./composition-active-clips.ts";
import { syncCanvasSurface } from "./composition-canvas.ts";
import {
  type ActiveClipTiming,
  computeActiveClipTimings,
  isGeneratedClip,
} from "./composition-clip-timing.ts";
import {
  disposeWebGlResources,
  drawComposition,
  ensureWebGlResources,
  type FrameContext,
  type WebGlResources,
} from "./composition-draw.ts";
import {
  type EffectIndex,
  indexEffects,
  stackEffects,
} from "./composition-effect-index.ts";
import { getGroupClipProgress } from "./composition-progress.ts";
import {
  LiveAudioBands,
  type MasterMeterTap,
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./fx-shaders/audio-bands.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import { getRenderedEffects } from "./fx-stack.ts";
import { listenForVideoFrames, releaseMediaElement } from "./media-element.ts";
import { seekMediaElement, syncPlaybackElement } from "./media-seek.ts";
import type { PlayheadSignal } from "./playhead-signal";
import { loadTextFaces, subscribeFonts } from "./text-fonts.ts";
import type { MeterSignature } from "./timeline-format.ts";

type CompositionPlayerProps = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
  playheadQ: number;
  bpm: number;
  // The session's frame rate, which effect animations are timed in.
  fps: number;
  // The session's time signature, which synced LFO animations follow.
  signature?: MeterSignature;
  // The session's length, where Clip-mode animations stop animating out.
  projectDurationFrames?: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  isAudibleScrubbing: boolean;
  isContinuousScrubbing: boolean;
  canvasWidth: number;
  canvasHeight: number;
  playheadSeconds: number;
  // Playback advances this every frame without re-rendering the player.
  playheadSignal: PlayheadSignal;
  // The clips the preview hears (see resolveAudioClips).
  audioMix?: AudioMix;
  // A text clip being typed on in the preview, whose text the on-canvas
  // editor shows instead.
  hiddenTextClipId?: string;
};

export type CompositionRendererState = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
  bpm: number;
  fps: number;
  signature?: MeterSignature;
  projectDurationFrames?: number;
  canvasWidth: number;
  canvasHeight: number;
  audioMix?: AudioMix;
  // Draws this text clip with no text: it keeps its slot, and its layer's
  // effects, but its text doesn't show twice under the editor.
  hiddenTextClipId?: string;
};

type CompositionPlaybackState = {
  playheadQ: number;
  playheadSeconds: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  isAudibleScrubbing: boolean;
  isContinuousScrubbing: boolean;
};

export type CompositionPlayerHandle = {
  getCanvas(): HTMLCanvasElement | null;
  renderFrameAt(playheadQ: number, playheadSeconds: number): Promise<void>;
  setVolume(volume: number, muted: boolean): void;
  getMasterMeterTap(): MasterMeterTap | null;
};

// Export measures audio-reactive effects on the mix at this rate.
const OFFLINE_BANDS_SAMPLE_RATE = 48000;

// "live" plays the audio mix and measures it as it plays (preview).
// "offline" renders the mix and measures it at each rendered frame (export).
export type AudioAnalysisMode = "live" | "offline";

export class CompositionRenderer {
  readonly canvas: HTMLCanvasElement;

  private resources: WebGlResources | null = null;
  // Media elements by source key (see ActiveClip.sourceKey), and the media
  // each one plays.
  private mediaRefs = new Map<string, HTMLMediaElement>();
  private mediaIdBySourceKey = new Map<string, string>();
  // Plays the audio mix in "live" mode.
  private mixer: PreviewAudioMixer | null = null;
  private removeVideoFrameReadyListeners: (() => void) | null = null;
  private videoFrameReadyListener: (() => void) | null = null;
  private state: CompositionRendererState;
  private activeClips: ActiveClip[] = [];
  // Derived from the state once per change rather than at every frame.
  private mediaById = new Map<string, MediaItem>();
  private lanePriority = new Map<string, number>();
  // Effects on layers whose FX switch is off are left out, clips included.
  private renderedEffects: EffectIndex<SessionEffect> = indexEffects([]);
  private sessionEffectIndex: EffectIndex<SessionEffect> = indexEffects([]);
  private readonly audioAnalysis: AudioAnalysisMode;
  private liveAudioBands = new LiveAudioBands();
  private offlineAudioBands: {
    mix: AudioMix;
    bands: Promise<OfflineAudioBands | null>;
  } | null = null;

  constructor(
    state: CompositionRendererState,
    options: {
      canvas?: HTMLCanvasElement;
      audioAnalysis?: AudioAnalysisMode;
    } = {},
  ) {
    this.canvas = options.canvas ?? document.createElement("canvas");
    this.audioAnalysis = options.audioAnalysis ?? "live";
    if (this.audioAnalysis === "live") {
      this.mixer = new PreviewAudioMixer({ workletUrl: CHAIN_WORKLET_URL });
    }
    this.state = state;
    this.update(state);
  }

  update(state: CompositionRendererState) {
    this.state = state;
    this.mediaById = new Map(state.mediaItems.map((item) => [item.id, item]));
    this.lanePriority = new Map(
      state.lanes.map((lane, index) => [lane.id, index]),
    );
    this.renderedEffects = indexEffects(
      getRenderedEffects(state.effects, state.lanes, state.clips),
    );
    this.sessionEffectIndex = indexEffects(state.effects);
    this.syncMediaElements();
    this.mixer?.update(this.audioMix(), state.mediaItems);
  }

  destroy() {
    this.clearVideoFrameReadyListeners();
    this.mixer?.dispose();
    this.mixer = null;
    this.offlineAudioBands = null;
    if (this.resources) {
      disposeWebGlResources(this.resources);
      this.resources = null;
    }

    for (const element of this.mediaRefs.values()) {
      releaseMediaElement(element);
    }
    this.mediaRefs.clear();
    this.mediaIdBySourceKey.clear();
  }

  // The preview playback volume, which export renders never set.
  setVolume(volume: number, muted: boolean) {
    this.mixer?.setVolume({ volume, muted });
  }

  // The program mix for the transport VU meter, before the preview volume.
  getMasterMeterTap() {
    return this.mixer?.meterTap ?? null;
  }

  // While playing, animating text and fills may be drawn from a nearby
  // raster; a paused preview, being edited, draws them exactly. Given a
  // `playback` state, the media is synced to it from the same active clips,
  // so a playback frame resolves them once.
  renderPreviewFrame(
    playheadQ: number,
    pixelRatio: number,
    playing = true,
    playback?: CompositionPlaybackState,
  ) {
    const audio = this.sampleLiveAudioBands();
    this.activeClips = this.computeActiveClips(playheadQ, audio);
    if (playback) {
      this.syncMedia(this.activeClips, playback);
    }
    this.draw(this.activeClips, playheadQ, pixelRatio, {
      time: quartersToSeconds(playheadQ, this.state.bpm),
      audio,
      groupClipProgress: this.groupClipProgressAt(playheadQ),
      preview: playing,
    });
  }

  async renderFrameAt(
    playheadQ: number,
    playheadSeconds: number,
    pixelRatio = 1,
  ) {
    this.ensureResources();
    syncCanvasSurface(
      this.canvas,
      this.state.canvasWidth,
      this.state.canvasHeight,
      pixelRatio,
    );

    const audio = await this.sampleAudioBandsAt(playheadSeconds);
    const nextActiveClips = this.computeActiveClips(playheadQ, audio);
    const pendingSeeks = new Map<string, Promise<void>>();

    for (const entry of nextActiveClips) {
      if (!entry.isInBounds) {
        continue;
      }

      const mediaElement = this.mediaRefs.get(entry.sourceKey);
      if (!(mediaElement instanceof HTMLVideoElement)) {
        continue;
      }

      pendingSeeks.set(
        entry.sourceKey,
        seekMediaElement(mediaElement, entry.mediaTime),
      );
    }

    if (pendingSeeks.size) {
      await Promise.all(pendingSeeks.values());
    }

    // Exported frames never draw text in a fallback font.
    await loadTextFaces(nextActiveClips.map((entry) => entry.text));

    this.activeClips = nextActiveClips;
    this.draw(nextActiveClips, playheadQ, pixelRatio, {
      time: playheadSeconds,
      audio,
      groupClipProgress: this.groupClipProgressAt(playheadQ),
    });
  }

  // Media sync needs only the clips' timing, not their effects.
  syncPlayback(playback: CompositionPlaybackState) {
    const timings = computeActiveClipTimings(
      this.state.clips,
      this.mediaById,
      playback.playheadQ,
      this.state.bpm,
      this.lanePriority,
    );
    this.ensureClipElements(timings);
    this.syncMedia(timings, playback);
  }

  private syncMedia(
    timings: readonly ActiveClipTiming[],
    playback: CompositionPlaybackState,
  ) {
    const activeClipBySourceKey = new Map(
      timings.map((entry) => [entry.sourceKey, entry]),
    );
    for (const [sourceKey, element] of this.mediaRefs) {
      const item = this.mediaById.get(
        this.mediaIdBySourceKey.get(sourceKey) ?? "",
      );
      if (!item) {
        continue;
      }

      syncPlaybackElement(
        element,
        activeClipBySourceKey.get(sourceKey),
        playback,
      );
    }

    this.mixer?.sync(playback);
  }

  addVideoFrameReadyListeners(scheduleDraw: () => void) {
    this.videoFrameReadyListener = scheduleDraw;
    this.refreshVideoFrameReadyListeners();

    return () => {
      if (this.videoFrameReadyListener === scheduleDraw) {
        this.videoFrameReadyListener = null;
        this.clearVideoFrameReadyListeners();
      }
    };
  }

  private ensureResources() {
    if (!this.resources) {
      this.resources = ensureWebGlResources(this.canvas);
    }
  }

  private computeActiveClips(playheadQ: number, audio = SILENT_AUDIO_BANDS) {
    const activeClips = computeActiveClips(
      this.state.clips,
      this.mediaById,
      playheadQ,
      this.state.bpm,
      this.lanePriority,
      this.renderedEffects,
      this.state.fps,
      audio,
      this.state.projectDurationFrames,
      this.state.signature,
    );

    for (const entry of activeClips) {
      if (entry.text && entry.clip.id === this.state.hiddenTextClipId) {
        entry.text = { ...entry.text, text: "" };
      }
    }
    this.ensureClipElements(activeClips);
    return activeClips;
  }

  // Clips sharing a media at this playhead draw from extra elements, made
  // the first time they are needed. Fill, text and FX clips draw no media.
  private ensureClipElements(timings: readonly ActiveClipTiming[]) {
    let addedElement = false;
    for (const entry of timings) {
      if (
        !isGeneratedClip(entry.clip) &&
        !this.mediaRefs.has(entry.sourceKey)
      ) {
        this.ensureMediaElement(entry.sourceKey, entry.media);
        addedElement = true;
      }
    }
    if (addedElement) {
      this.refreshVideoFrameReadyListeners();
    }
  }

  private groupClipProgressAt(playheadQ: number) {
    return getGroupClipProgress(this.state.clips, playheadQ, this.state.bpm);
  }

  private audioMix() {
    return this.state.audioMix ?? SILENT_AUDIO_MIX;
  }

  // The mix is measured only while some effect reacts to it.
  private sampleLiveAudioBands() {
    const analyser = liveBandsAnalyser(
      this.renderedEffects.effects,
      this.mixer?.analyser ?? null,
    );
    return this.liveAudioBands.sample(analyser, performance.now());
  }

  private async sampleAudioBandsAt(playheadSeconds: number) {
    if (this.audioAnalysis === "live") {
      return this.sampleLiveAudioBands();
    }

    const mix = this.audioMix();
    if (!this.renderedEffects.effects.some(effectUsesAudio)) {
      return SILENT_AUDIO_BANDS;
    }

    // A mix resolved again, after an edit, is measured again.
    if (this.offlineAudioBands?.mix !== mix) {
      const sampleRate = OFFLINE_BANDS_SAMPLE_RATE;
      this.offlineAudioBands = {
        mix,
        bands: renderAudioMixOffline(mix, this.state.mediaItems, {
          sampleRate,
          numberOfChannels: 2,
          startSeconds: 0,
          length: Math.ceil(audioMixEndSeconds(mix) * sampleRate),
        })
          .then((channels) =>
            channels
              ? OfflineAudioBands.fromChannels(channels, sampleRate)
              : null,
          )
          .catch((error) => {
            console.warn("Export renders effects without audio bands.", error);
            return null;
          }),
      };
    }

    const bands = await this.offlineAudioBands.bands;
    return bands?.at(playheadSeconds) ?? SILENT_AUDIO_BANDS;
  }

  private draw(
    activeClips: ActiveClip[],
    playheadQ: number,
    pixelRatio: number,
    frameContext: FrameContext,
  ) {
    this.ensureResources();
    syncCanvasSurface(
      this.canvas,
      this.state.canvasWidth,
      this.state.canvasHeight,
      pixelRatio,
    );
    // The Global chain and Order span every layer, so they animate with
    // the topmost clip. Only the Global stack is drawn from these.
    const effects = resolveFrameEffects(
      stackEffects(this.sessionEffectIndex, GROUP_TRACK_ID),
      activeClips,
      playheadQ,
      this.state.bpm,
      this.state.fps,
      this.state.signature,
    );
    drawComposition(
      this.resources as WebGlResources,
      this.canvas,
      activeClips,
      this.mediaRefs,
      resolveEffectChain(effects, GROUP_TRACK_ID),
      frameContext,
      resolveAnimatedOrder(effects, GROUP_TRACK_ID, this.state.fps),
    );
  }

  private ensureMediaElement(sourceKey: string, item: MediaItem) {
    let element = this.mediaRefs.get(sourceKey);
    if (!element) {
      element =
        item.kind === "video"
          ? document.createElement("video")
          : document.createElement("audio");
      element.crossOrigin = "anonymous";
      element.preload = "auto";
      if (element instanceof HTMLVideoElement) {
        element.playsInline = true;
      }
      // Clip audio plays through the mixer instead.
      element.muted = true;
      this.mediaRefs.set(sourceKey, element);
      this.mediaIdBySourceKey.set(sourceKey, item.id);
    }

    if (element.getAttribute("src") !== item.previewUrl) {
      element.src = item.previewUrl;
    }
  }

  private syncMediaElements() {
    for (const [sourceKey, element] of this.mediaRefs) {
      const item = this.mediaById.get(
        this.mediaIdBySourceKey.get(sourceKey) ?? "",
      );
      if (item) {
        this.ensureMediaElement(sourceKey, item);
        continue;
      }

      releaseMediaElement(element);
      this.mediaRefs.delete(sourceKey);
      this.mediaIdBySourceKey.delete(sourceKey);
    }

    for (const item of this.state.mediaItems) {
      this.ensureMediaElement(item.id, item);
    }

    this.refreshVideoFrameReadyListeners();
  }

  private refreshVideoFrameReadyListeners() {
    this.clearVideoFrameReadyListeners();
    if (this.videoFrameReadyListener) {
      this.removeVideoFrameReadyListeners = listenForVideoFrames(
        this.mediaRefs.values(),
        this.videoFrameReadyListener,
      );
    }
  }

  private clearVideoFrameReadyListeners() {
    this.removeVideoFrameReadyListeners?.();
    this.removeVideoFrameReadyListeners = null;
  }
}

export const CompositionPlayer = forwardRef<
  CompositionPlayerHandle,
  CompositionPlayerProps
>(function CompositionPlayer(
  {
    mediaItems,
    clips,
    lanes,
    effects,
    playheadQ,
    bpm,
    fps,
    signature,
    projectDurationFrames,
    isPlaying,
    isScrubbing,
    isAudibleScrubbing,
    isContinuousScrubbing,
    canvasWidth,
    canvasHeight,
    playheadSeconds,
    playheadSignal,
    audioMix,
    hiddenTextClipId,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CompositionRenderer | null>(null);
  const playbackFrameRef = useRef<number>(0);
  const renderRequestRef = useRef<number>(0);
  const rendererState = useMemo(
    () => ({
      mediaItems,
      clips,
      lanes,
      effects,
      bpm,
      fps,
      signature,
      projectDurationFrames,
      canvasWidth,
      canvasHeight,
      audioMix,
      hiddenTextClipId,
    }),
    [
      audioMix,
      bpm,
      canvasHeight,
      canvasWidth,
      clips,
      effects,
      fps,
      hiddenTextClipId,
      lanes,
      mediaItems,
      projectDurationFrames,
      signature,
    ],
  );
  const rendererStateRef = useRef(rendererState);
  rendererStateRef.current = rendererState;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const drawCurrentFrame = useCallback(
    (pixelRatio: number) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }

      // Video frames can land mid-playback, when the prop lags the playhead.
      renderer.renderPreviewFrame(
        isPlayingRef.current ? playheadSignal.get() : playheadQ,
        pixelRatio,
        isPlayingRef.current,
      );
    },
    [playheadQ, playheadSignal],
  );

  const scheduleDraw = useCallback(
    (pixelRatio = window.devicePixelRatio || 1) => {
      if (renderRequestRef.current) {
        window.cancelAnimationFrame(renderRequestRef.current);
      }

      renderRequestRef.current = window.requestAnimationFrame(() => {
        renderRequestRef.current = 0;
        drawCurrentFrame(pixelRatio);
      });
    },
    [drawCurrentFrame],
  );
  const scheduleDrawRef = useRef(scheduleDraw);
  scheduleDrawRef.current = scheduleDraw;
  const playbackState: CompositionPlaybackState = {
    playheadQ,
    playheadSeconds,
    isPlaying,
    isScrubbing,
    isAudibleScrubbing,
    isContinuousScrubbing,
  };
  const playbackStateRef = useRef(playbackState);
  playbackStateRef.current = playbackState;

  const renderFrameAt = useCallback(
    async (
      nextPlayheadQ: number,
      nextPlayheadSeconds: number,
      pixelRatio: number,
    ) => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) {
        return;
      }

      await renderer.renderFrameAt(
        nextPlayheadQ,
        nextPlayheadSeconds,
        pixelRatio,
      );
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      getCanvas: () => canvasRef.current,
      renderFrameAt: (nextPlayheadQ, nextPlayheadSeconds) =>
        renderFrameAt(nextPlayheadQ, nextPlayheadSeconds, 1),
      setVolume: (volume, muted) =>
        rendererRef.current?.setVolume(volume, muted),
      getMasterMeterTap: () => rendererRef.current?.getMasterMeterTap() ?? null,
    }),
    [renderFrameAt],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    rendererRef.current = new CompositionRenderer(rendererStateRef.current, {
      canvas,
    });

    return () => {
      if (playbackFrameRef.current) {
        window.cancelAnimationFrame(playbackFrameRef.current);
      }
      if (renderRequestRef.current) {
        window.cancelAnimationFrame(renderRequestRef.current);
      }
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update(rendererState);
    // A paused preview only redraws on request, so edits such as effect or
    // layer FX bypasses would otherwise not show until the playhead moves.
    // Edits such as one to a layer clip's source clip also move its media's
    // time at the playhead, so seek there too; the new frame redraws again.
    if (!isPlayingRef.current) {
      rendererRef.current?.syncPlayback(playbackStateRef.current);
      scheduleDrawRef.current();
    }
  }, [rendererState]);

  useEffect(() => {
    if (isPlaying) {
      return;
    }

    scheduleDraw();
  }, [isPlaying, scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rendererRef.current) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;

    const render = () => {
      const renderer = rendererRef.current;
      if (!canvasRef.current || !renderer) {
        return;
      }

      if (!isPlaying) {
        drawCurrentFrame(pixelRatio);
        return;
      }

      // The playhead prop only catches up now and then during playback, so
      // follow the live playhead and keep the media in sync with it here.
      const livePlayheadQ = playheadSignal.get();
      renderer.renderPreviewFrame(livePlayheadQ, pixelRatio, true, {
        ...playbackStateRef.current,
        playheadQ: livePlayheadQ,
        playheadSeconds: quartersToSeconds(
          livePlayheadQ,
          rendererStateRef.current.bpm,
        ),
        isPlaying,
      });
      playbackFrameRef.current = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      if (playbackFrameRef.current) {
        window.cancelAnimationFrame(playbackFrameRef.current);
      }
    };
  }, [drawCurrentFrame, isPlaying, playheadSignal]);

  useEffect(() => {
    return rendererRef.current?.addVideoFrameReadyListeners(scheduleDraw);
  }, [scheduleDraw]);

  // Text waits for its font, so a paused preview redraws once it loads.
  useEffect(
    () =>
      subscribeFonts(() => {
        if (!isPlayingRef.current) {
          scheduleDrawRef.current();
        }
      }),
    [],
  );

  useEffect(() => {
    rendererRef.current?.syncPlayback({
      playheadQ,
      playheadSeconds,
      isPlaying,
      isScrubbing,
      isAudibleScrubbing,
      isContinuousScrubbing,
    });
  }, [
    isAudibleScrubbing,
    isContinuousScrubbing,
    isPlaying,
    isScrubbing,
    playheadQ,
    playheadSeconds,
  ]);

  return (
    <div className="composition-player">
      <canvas className="composition-player__canvas" ref={canvasRef} />
    </div>
  );
});
