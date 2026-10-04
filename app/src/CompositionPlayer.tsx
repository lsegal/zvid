import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { clamp } from "./app/util.ts";
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
  type MediaItem,
  quartersToSeconds,
  resolveAnimatedOrder,
  resolveFrameEffects,
  type SessionEffect,
} from "./composition-active-clips.ts";
import { syncCanvasSurface } from "./composition-canvas.ts";
import {
  disposeWebGlResources,
  drawComposition,
  ensureWebGlResources,
  type FrameContext,
  type WebGlResources,
} from "./composition-draw.ts";
import { getGroupClipProgress } from "./composition-progress.ts";
import {
  LiveAudioBands,
  type MasterMeterTap,
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./fx-shaders/audio-bands.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import { getRenderedEffects } from "./fx-stack.ts";
import { listenForVideoFrames } from "./media-element.ts";
import {
  cancelQueuedSeek,
  needsPlaybackSeek,
  nudgedPlaybackRate,
  seekMediaElement,
  seekWhenReady,
} from "./media-seek.ts";
import { MediaElementPool, mediaWindowAt } from "./media-window.ts";
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
// The playback rates every browser accepts; a media element throws outside
// them.
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;

// "live" plays the audio mix and measures it as it plays (preview).
// "offline" renders the mix and measures it at each rendered frame (export).
export type AudioAnalysisMode = "live" | "offline";

export class CompositionRenderer {
  readonly canvas: HTMLCanvasElement;

  private resources: WebGlResources | null = null;
  // Video elements for the media near the playhead (see mediaWindowAt).
  private media = new MediaElementPool();
  private windowPlayheadQ = 0;
  // Plays the audio mix in "live" mode.
  private mixer: PreviewAudioMixer | null = null;
  private removeVideoFrameReadyListeners: (() => void) | null = null;
  private videoFrameReadyListener: (() => void) | null = null;
  private state: CompositionRendererState;
  private activeClips: ActiveClip[] = [];
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
    this.syncMediaWindow(this.windowPlayheadQ);
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
  // raster; a paused preview, being edited, draws them exactly.
  renderPreviewFrame(playheadQ: number, pixelRatio: number, playing = true) {
    this.ensureResources();
    const audio = this.sampleLiveAudioBands();
    this.activeClips = this.computeActiveClips(playheadQ, audio);
    this.draw(this.activeClips, playheadQ, pixelRatio, {
      time: quartersToSeconds(playheadQ, this.state.bpm),
      audio: audio ?? SILENT_AUDIO_BANDS,
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

    // Exported frames never draw text in a fallback font.
    await loadTextFaces(nextActiveClips.map((entry) => entry.text));

    this.activeClips = nextActiveClips;
    this.draw(nextActiveClips, playheadQ, pixelRatio, {
      time: playheadSeconds,
      audio,
      groupClipProgress: this.groupClipProgressAt(playheadQ),
    });
  }

  syncPlayback(playback: CompositionPlaybackState) {
    const activeClipBySourceKey = new Map(
      this.computeActiveClips(playback.playheadQ).map((entry) => [
        entry.sourceKey,
        entry,
      ]),
    );
    this.syncMediaWindow(playback.playheadQ);
    const steady = playback.isPlaying && !playback.isScrubbing;

    for (const [sourceKey, element] of this.media.elements) {
      const activeEntry = activeClipBySourceKey.get(sourceKey);
      if (!activeEntry?.isInBounds) {
        if (!element.paused) {
          element.pause();
        }
        continue;
      }

      // A warped clip changes speed between its warp markers; the drift
      // check below re-seeks it at each marker. Smaller drift in steady
      // playback is made up by playing a little faster or slower.
      const behind = activeEntry.mediaTime - element.currentTime;
      const playbackRate = clamp(
        steady
          ? nudgedPlaybackRate(activeEntry.playbackRate, behind)
          : activeEntry.playbackRate,
        MIN_PLAYBACK_RATE,
        MAX_PLAYBACK_RATE,
      );
      if (element.playbackRate !== playbackRate) {
        element.playbackRate = playbackRate;
      }

      if (needsPlaybackSeek(Math.abs(behind), playback)) {
        seekWhenReady(element, activeEntry.mediaTime);
      } else {
        cancelQueuedSeek(element);
      }

      // Clip audio plays through the mixer; these elements are only drawn.
      if (playback.isPlaying) {
        if (element.paused) {
          element.play().catch(() => {});
        }
      } else if (!element.paused) {
        element.pause();
      }
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
    const mediaById = new Map(
      this.state.mediaItems.map((item) => [item.id, item]),
    );
    const lanePriority = new Map(
      this.state.lanes.map((lane, index) => [lane.id, index]),
    );

    const activeClips = computeActiveClips(
      this.state.clips,
      mediaById,
      playheadQ,
      this.state.bpm,
      lanePriority,
      this.renderedEffects(),
      this.state.fps,
      audio,
      this.state.projectDurationFrames,
      this.state.signature,
    );

    // Clips sharing a media at this playhead draw from extra elements, made
    // the first time they are needed. Fill, text and FX clips draw no media.
    let addedElement = false;
    for (const entry of activeClips) {
      if (entry.text && entry.clip.id === this.state.hiddenTextClipId) {
        entry.text = { ...entry.text, text: "" };
      }
      if (
        !entry.fill &&
        !entry.text &&
        !entry.fx &&
        entry.media.kind === "video" &&
        this.media.ensure(entry.sourceKey, entry.media, "auto")
      ) {
        addedElement = true;
      }
    }
    if (addedElement) {
      this.refreshVideoFrameReadyListeners();
    }

    return activeClips;
  }

  private groupClipProgressAt(playheadQ: number) {
    return getGroupClipProgress(this.state.clips, playheadQ, this.state.bpm);
  }

  // Effects on layers whose FX switch is off are left out, clips included.
  private renderedEffects() {
    const { effects, lanes, clips } = this.state;
    return getRenderedEffects(effects, lanes, clips);
  }

  private usesAudioBands() {
    return this.renderedEffects().some(effectUsesAudio);
  }

  private audioMix() {
    return this.state.audioMix ?? SILENT_AUDIO_MIX;
  }

  private sampleLiveAudioBands() {
    return this.liveAudioBands.sample(
      this.mixer?.analyser ?? null,
      performance.now(),
    );
  }

  private async sampleAudioBandsAt(playheadSeconds: number) {
    if (this.audioAnalysis === "live") {
      return this.sampleLiveAudioBands();
    }

    const mix = this.audioMix();
    if (!this.usesAudioBands()) {
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
    // the topmost clip.
    const effects = resolveFrameEffects(
      this.state.effects,
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
      this.media.elements,
      resolveEffectChain(effects, GROUP_TRACK_ID),
      frameContext,
      resolveAnimatedOrder(effects, GROUP_TRACK_ID, this.state.fps),
    );
  }

  // Keeps video elements only for the media near `playheadQ`.
  private syncMediaWindow(playheadQ: number) {
    this.windowPlayheadQ = playheadQ;
    const { clips, mediaItems, bpm } = this.state;
    const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
    const window = mediaWindowAt(
      clips,
      mediaById,
      quartersToSeconds(playheadQ, bpm),
      bpm,
    );
    if (this.media.sync(window, mediaById)) {
      this.refreshVideoFrameReadyListeners();
    }
  }

  private refreshVideoFrameReadyListeners() {
    this.clearVideoFrameReadyListeners();
    if (this.videoFrameReadyListener) {
      this.removeVideoFrameReadyListeners = listenForVideoFrames(
        this.media.elements.values(),
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
      renderer.syncPlayback({
        ...playbackStateRef.current,
        playheadQ: livePlayheadQ,
        playheadSeconds: quartersToSeconds(
          livePlayheadQ,
          rendererStateRef.current.bpm,
        ),
        isPlaying,
      });
      renderer.renderPreviewFrame(livePlayheadQ, pixelRatio);
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
