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
  EXPORT_CONTEXT_ATTRIBUTES,
  PREVIEW_CONTEXT_ATTRIBUTES,
} from "./composition-context.ts";
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
import type { CompositionRendererState } from "./composition-renderer-state.ts";
import { loadFrameAssets, subscribeFrameAssets } from "./frame-assets.ts";
import {
  LiveAudioBands,
  type MasterMeterTap,
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./fx-shaders/audio-bands.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import { getRenderedEffects } from "./fx-stack.ts";
import { usePreviewPixelRatio } from "./hooks/usePreviewPixelRatio.ts";
import { listenForVideoFrames } from "./media-element.ts";
import { seekMediaElement, syncPlaybackElement } from "./media-seek.ts";
import {
  drawnClipOf,
  MediaElementPool,
  mediaWindowAt,
} from "./media-window.ts";
import type { PlayheadSignal } from "./playhead-signal";
import type { MeterSignature } from "./timeline-format.ts";
import { usePausedPlayheadFollow } from "./use-paused-playhead-follow.ts";

type CompositionPlayerProps = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
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
  // The playhead the player draws and plays from. Playback and drag-scrubbing
  // move it every frame without re-rendering the player; seeks move it with
  // the playhead state.
  playheadSignal: PlayheadSignal;
  // The clips the preview hears (see resolveAudioClips).
  audioMix?: AudioMix;
  // A text clip being typed on in the preview, whose text the on-canvas
  // editor shows instead.
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
  // Video elements for the media near the playhead (see mediaWindowAt).
  private media = new MediaElementPool();
  // The mixer's video elements active clips draw instead, by source key,
  // so an audible video clip's media is opened once.
  private sharedElements = new Map<string, HTMLVideoElement>();
  private windowPlayheadQ = 0;
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
  private readonly contextAttributes: WebGLContextAttributes;
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
      // The preview passes its own; export keeps the default.
      contextAttributes?: WebGLContextAttributes;
    } = {},
  ) {
    this.canvas = options.canvas ?? document.createElement("canvas");
    this.audioAnalysis = options.audioAnalysis ?? "live";
    this.contextAttributes =
      options.contextAttributes ?? EXPORT_CONTEXT_ATTRIBUTES;
    if (this.audioAnalysis === "live") {
      this.mixer = new PreviewAudioMixer({
        workletUrl: CHAIN_WORKLET_URL,
        onVideoElementsChange: () => this.refreshVideoFrameReadyListeners(),
      });
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
    this.mixer?.update(this.audioMix(), state.mediaItems);
    this.syncMediaWindow(this.windowPlayheadQ);
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
    this.media.clear();
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
    // The mixer syncs first, so clips it plays from video elements draw
    // from them.
    if (playback) {
      this.mixer?.sync(playback);
    }
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
    // Exact frames draw only from the compositor's own elements.
    const nextActiveClips = this.computeActiveClips(playheadQ, audio, false);
    this.syncMediaWindow(playheadQ);
    const pendingSeeks = new Map<string, Promise<void>>();

    for (const entry of nextActiveClips) {
      if (!entry.isInBounds) {
        continue;
      }

      const mediaElement = this.media.elements.get(entry.sourceKey);
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

    // Exact frames wait for their text fonts and Custom shape SVGs.
    await loadFrameAssets(nextActiveClips, this.state.effects);

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
    this.mixer?.sync(playback);
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
    this.syncMediaWindow(playback.playheadQ);
    for (const [sourceKey, element] of this.media.elements) {
      // An element whose clip draws the mixer's instead waits, paused.
      syncPlaybackElement(
        element,
        this.sharedElements.has(sourceKey)
          ? undefined
          : activeClipBySourceKey.get(sourceKey),
        playback,
      );
    }
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
      this.resources = ensureWebGlResources(
        this.canvas,
        this.contextAttributes,
      );
    }
  }

  private computeActiveClips(
    playheadQ: number,
    audio = SILENT_AUDIO_BANDS,
    share = true,
  ) {
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
    this.ensureClipElements(activeClips, share);
    return activeClips;
  }

  // A clip the mixer plays from a video element draws from it, unless not
  // to `share`. Clips sharing a media at this playhead draw from extra
  // elements, made the first time they are needed. Fill, text and FX clips
  // draw no media.
  private ensureClipElements(
    timings: readonly ActiveClipTiming[],
    share = true,
  ) {
    let addedElement = false;
    this.sharedElements.clear();
    for (const entry of timings) {
      if (isGeneratedClip(entry.clip) || entry.media.kind !== "video") {
        continue;
      }
      const shared = share
        ? this.mixer?.videoElementFor(drawnClipOf(entry.clip, this.state.bpm))
        : undefined;
      if (shared) {
        this.sharedElements.set(entry.sourceKey, shared);
      } else if (this.media.ensure(entry.sourceKey, entry.media, "auto")) {
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
      this.media.drawnWith(this.sharedElements),
      resolveEffectChain(effects, GROUP_TRACK_ID),
      frameContext,
      resolveAnimatedOrder(effects, GROUP_TRACK_ID, this.state.fps),
    );
  }

  // Keeps video elements only for the media near `playheadQ`.
  private syncMediaWindow(playheadQ: number) {
    this.windowPlayheadQ = playheadQ;
    const { clips, bpm } = this.state;
    const window = mediaWindowAt(
      clips,
      this.mediaById,
      quartersToSeconds(playheadQ, bpm),
      bpm,
      (clip) => Boolean(this.mixer?.playsVideoOf(drawnClipOf(clip, bpm))),
    );
    if (this.media.sync(window, this.mediaById)) {
      this.refreshVideoFrameReadyListeners();
    }
  }

  private refreshVideoFrameReadyListeners() {
    this.clearVideoFrameReadyListeners();
    if (this.videoFrameReadyListener) {
      this.removeVideoFrameReadyListeners = listenForVideoFrames(
        [
          ...this.media.elements.values(),
          ...(this.mixer?.videoElements() ?? []),
        ],
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
  const redrawIfPaused = useCallback(() => {
    if (!isPlayingRef.current) {
      scheduleDrawRef.current();
    }
  }, []);
  const previewPixelRatio = usePreviewPixelRatio(
    canvasRef,
    { width: canvasWidth, height: canvasHeight },
    redrawIfPaused,
  );

  // Reads the playhead from the signal rather than a prop, so a playhead
  // commit doesn't recreate the draw callbacks and restart the effects that
  // depend on them, such as the playback loop.
  const drawCurrentFrame = useCallback(
    (pixelRatio: number) => {
      rendererRef.current?.renderPreviewFrame(
        playheadSignal.get(),
        pixelRatio,
        isPlayingRef.current,
      );
    },
    [playheadSignal],
  );

  const scheduleDraw = useCallback(
    (pixelRatio = previewPixelRatio()) => {
      if (renderRequestRef.current) {
        window.cancelAnimationFrame(renderRequestRef.current);
      }

      renderRequestRef.current = window.requestAnimationFrame(() => {
        renderRequestRef.current = 0;
        drawCurrentFrame(pixelRatio);
      });
    },
    [drawCurrentFrame, previewPixelRatio],
  );
  const scheduleDrawRef = useRef(scheduleDraw);
  scheduleDrawRef.current = scheduleDraw;
  const playbackFlags = {
    isPlaying,
    isScrubbing,
    isAudibleScrubbing,
    isContinuousScrubbing,
  };
  const playbackFlagsRef = useRef(playbackFlags);
  playbackFlagsRef.current = playbackFlags;
  const readPlaybackState = useCallback((): CompositionPlaybackState => {
    const playheadQ = playheadSignal.get();
    return {
      ...playbackFlagsRef.current,
      playheadQ,
      playheadSeconds: quartersToSeconds(
        playheadQ,
        rendererStateRef.current.bpm,
      ),
    };
  }, [playheadSignal]);

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
      contextAttributes: PREVIEW_CONTEXT_ATTRIBUTES,
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
      rendererRef.current?.syncPlayback(readPlaybackState());
      scheduleDrawRef.current();
    }
  }, [readPlaybackState, rendererState]);

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

    const render = () => {
      const renderer = rendererRef.current;
      if (!canvasRef.current || !renderer) {
        return;
      }

      const pixelRatio = previewPixelRatio();
      if (!isPlaying) {
        drawCurrentFrame(pixelRatio);
        return;
      }

      // Playback only moves the live playhead; the same frame's active clips
      // keep the media in sync with it and draw it.
      const playback = readPlaybackState();
      renderer.renderPreviewFrame(playback.playheadQ, pixelRatio, true, {
        ...playback,
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
  }, [drawCurrentFrame, isPlaying, previewPixelRatio, readPlaybackState]);

  // While paused, seeks and drag-scrubbing move the live playhead.
  usePausedPlayheadFollow(playheadSignal, isPlaying, () => {
    const playback = readPlaybackState();
    rendererRef.current?.renderPreviewFrame(
      playback.playheadQ,
      previewPixelRatio(),
      false,
      playback,
    );
  });

  useEffect(() => {
    return rendererRef.current?.addVideoFrameReadyListeners(scheduleDraw);
  }, [scheduleDraw]);

  // A paused preview redraws once a text font or Custom shape SVG loads.
  useEffect(() => subscribeFrameAssets(redrawIfPaused), [redrawIfPaused]);

  // The playback loop syncs every frame while playing.
  useEffect(() => {
    void [isAudibleScrubbing, isContinuousScrubbing, isScrubbing];
    if (!isPlaying) {
      rendererRef.current?.syncPlayback(readPlaybackState());
    }
  }, [
    isAudibleScrubbing,
    isContinuousScrubbing,
    isPlaying,
    isScrubbing,
    readPlaybackState,
  ]);

  return (
    <div className="composition-player">
      <canvas className="composition-player__canvas" ref={canvasRef} />
    </div>
  );
});
