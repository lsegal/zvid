import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
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
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./fx-shaders/audio-bands.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import { getRenderedEffects } from "./fx-stack.ts";
import { seekMediaElement } from "./media-seek.ts";
import type { PlayheadSignal } from "./playhead-signal";
import { loadFontFace, resolveFontFace, subscribeFonts } from "./text-fonts.ts";

type CompositionPlayerProps = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
  playheadQ: number;
  bpm: number;
  // The session's frame rate, which effect animations are timed in.
  fps: number;
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
  mainAudio?: MediaItem;
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
  projectDurationFrames?: number;
  canvasWidth: number;
  canvasHeight: number;
  mainAudio?: MediaItem;
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
};

const MAX_DRIFT_SECONDS = 0.18;
const SCRUB_AUDIO_DRIFT_SECONDS = 0.035;
// Audio keeps playing through a scrub started during playback, so it only
// re-syncs once it falls this far behind or ahead of the playhead.
const CONTINUOUS_SCRUB_AUDIO_DRIFT_SECONDS = 0.1;
// The playback rates every browser accepts; a media element throws outside
// them.
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

// "live" reads the main audio element as it plays (preview). "offline"
// decodes the main audio and measures it at each rendered frame (export).
export type AudioAnalysisMode = "live" | "offline";

export class CompositionRenderer {
  readonly canvas: HTMLCanvasElement;

  private resources: WebGlResources | null = null;
  // Media elements by source key (see ActiveClip.sourceKey), and the media
  // each one plays.
  private mediaRefs = new Map<string, HTMLMediaElement>();
  private mediaIdBySourceKey = new Map<string, string>();
  private mainAudioElement: HTMLAudioElement | null = null;
  private removeVideoFrameReadyListeners: Array<() => void> = [];
  private videoFrameReadyListener: (() => void) | null = null;
  private state: CompositionRendererState;
  private activeClips: ActiveClip[] = [];
  private readonly audioAnalysis: AudioAnalysisMode;
  private liveAudioBands: LiveAudioBands | null = null;
  private offlineAudioBands: {
    url: string;
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
    this.state = state;
    this.update(state);
  }

  update(state: CompositionRendererState) {
    this.state = state;
    this.syncMediaElements();
  }

  destroy() {
    this.clearVideoFrameReadyListeners();
    this.liveAudioBands?.dispose();
    this.liveAudioBands = null;
    this.offlineAudioBands = null;
    if (this.resources) {
      disposeWebGlResources(this.resources);
      this.resources = null;
    }

    for (const element of this.mediaRefs.values()) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    this.mediaRefs.clear();
    this.mediaIdBySourceKey.clear();

    if (this.mainAudioElement) {
      this.mainAudioElement.pause();
      this.mainAudioElement.removeAttribute("src");
      this.mainAudioElement.load();
      this.mainAudioElement = null;
    }
  }

  // While playing, animating text and fills may be drawn from a nearby
  // raster; a paused preview, being edited, draws them exactly.
  renderPreviewFrame(playheadQ: number, pixelRatio: number, playing = true) {
    this.ensureResources();
    const audio = this.liveAudioBands?.sample(performance.now());
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
    await Promise.all(
      nextActiveClips.map((entry) =>
        entry.text
          ? loadFontFace(
              resolveFontFace(
                entry.text.font,
                entry.text.weight,
                entry.text.italic,
              ),
            )
          : undefined,
      ),
    );

    if (this.mainAudioElement && this.state.mainAudio?.previewUrl) {
      this.mainAudioElement.pause();
      this.mainAudioElement.currentTime = playheadSeconds;
    }

    this.activeClips = nextActiveClips;
    this.draw(nextActiveClips, playheadQ, pixelRatio, {
      time: playheadSeconds,
      audio,
      groupClipProgress: this.groupClipProgressAt(playheadQ),
    });
  }

  syncPlayback(playback: CompositionPlaybackState) {
    const isContinuousScrubAudio =
      playback.isAudibleScrubbing && playback.isContinuousScrubbing;
    const activeClipBySourceKey = new Map(
      this.computeActiveClips(playback.playheadQ).map((entry) => [
        entry.sourceKey,
        entry,
      ]),
    );
    const mediaById = new Map(
      this.state.mediaItems.map((item) => [item.id, item]),
    );

    for (const [sourceKey, element] of this.mediaRefs) {
      const item = mediaById.get(this.mediaIdBySourceKey.get(sourceKey) ?? "");
      if (!item) {
        continue;
      }

      const activeEntry = activeClipBySourceKey.get(sourceKey);
      if (!activeEntry?.isInBounds) {
        if (!element.paused) {
          element.pause();
        }
        continue;
      }

      // A warped clip changes speed between its warp markers; the drift
      // check below re-seeks it at each marker.
      const playbackRate = clamp(
        activeEntry.playbackRate,
        MIN_PLAYBACK_RATE,
        MAX_PLAYBACK_RATE,
      );
      if (element.playbackRate !== playbackRate) {
        element.playbackRate = playbackRate;
      }

      const drift = Math.abs(element.currentTime - activeEntry.mediaTime);
      const needsSeek =
        isContinuousScrubAudio && item.kind !== "video"
          ? drift > CONTINUOUS_SCRUB_AUDIO_DRIFT_SECONDS
          : !playback.isPlaying ||
            playback.isScrubbing ||
            drift > MAX_DRIFT_SECONDS;
      if (needsSeek) {
        element.currentTime = activeEntry.mediaTime;
      }

      const shouldPlay =
        item.kind === "video"
          ? playback.isPlaying
          : playback.isPlaying || playback.isAudibleScrubbing;
      if (shouldPlay) {
        element.play().catch(() => {});
      } else if (!element.paused) {
        element.pause();
      }
    }

    const audio = this.mainAudioElement;
    if (!audio || !this.state.mainAudio?.previewUrl) {
      return;
    }

    const shouldPlay = playback.isPlaying || playback.isAudibleScrubbing;
    if (shouldPlay) {
      this.liveAudioBands?.resume();
    }
    const driftTolerance = isContinuousScrubAudio
      ? CONTINUOUS_SCRUB_AUDIO_DRIFT_SECONDS
      : playback.isAudibleScrubbing
        ? SCRUB_AUDIO_DRIFT_SECONDS
        : MAX_DRIFT_SECONDS;
    const drift = Math.abs(audio.currentTime - playback.playheadSeconds);
    if (!shouldPlay || drift > driftTolerance) {
      audio.currentTime = playback.playheadSeconds;
    }

    if (shouldPlay) {
      audio.play().catch(() => {});
    } else if (!audio.paused) {
      audio.pause();
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
        !this.mediaRefs.has(entry.sourceKey)
      ) {
        this.ensureMediaElement(entry.sourceKey, entry.media);
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

  // Effects on layers whose FX switch is off are left out, apart from their
  // Layout anchoring.
  private renderedEffects() {
    return getRenderedEffects(this.state.effects, this.state.lanes);
  }

  private usesAudioBands() {
    return this.renderedEffects().some(effectUsesAudio);
  }

  private async sampleAudioBandsAt(playheadSeconds: number) {
    if (this.audioAnalysis === "live") {
      return (
        this.liveAudioBands?.sample(performance.now()) ?? SILENT_AUDIO_BANDS
      );
    }

    const url = this.state.mainAudio?.previewUrl;
    if (!url || !this.usesAudioBands()) {
      return SILENT_AUDIO_BANDS;
    }

    if (this.offlineAudioBands?.url !== url) {
      this.offlineAudioBands = {
        url,
        bands: OfflineAudioBands.decode(url).catch((error) => {
          console.warn("Export renders effects without audio bands.", error);
          return null;
        }),
      };
    }

    const bands = await this.offlineAudioBands.bands;
    return bands?.at(playheadSeconds) ?? SILENT_AUDIO_BANDS;
  }

  private syncLiveAudioBands() {
    if (this.audioAnalysis !== "live") {
      return;
    }

    if (this.mainAudioElement && this.usesAudioBands()) {
      this.liveAudioBands ??= new LiveAudioBands();
    }
    // Once routed through Web Audio the element must stay attached, or it
    // would go silent, so the analyser follows the element even after the
    // effects that needed it are removed.
    this.liveAudioBands?.attach(this.mainAudioElement);
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
        element.muted = true;
        element.playsInline = true;
      }
      this.mediaRefs.set(sourceKey, element);
      this.mediaIdBySourceKey.set(sourceKey, item.id);
    }

    if (element.getAttribute("src") !== item.previewUrl) {
      element.src = item.previewUrl;
    }
  }

  private syncMediaElements() {
    const mediaById = new Map(
      this.state.mediaItems.map((item) => [item.id, item]),
    );
    for (const [sourceKey, element] of this.mediaRefs) {
      const item = mediaById.get(this.mediaIdBySourceKey.get(sourceKey) ?? "");
      if (item) {
        this.ensureMediaElement(sourceKey, item);
        continue;
      }

      element.pause();
      element.removeAttribute("src");
      element.load();
      this.mediaRefs.delete(sourceKey);
      this.mediaIdBySourceKey.delete(sourceKey);
    }

    for (const item of this.state.mediaItems) {
      this.ensureMediaElement(item.id, item);
    }

    if (this.state.mainAudio?.previewUrl) {
      if (!this.mainAudioElement) {
        this.mainAudioElement = document.createElement("audio");
        this.mainAudioElement.crossOrigin = "anonymous";
        this.mainAudioElement.preload = "auto";
      }
      if (
        this.mainAudioElement.getAttribute("src") !==
        this.state.mainAudio.previewUrl
      ) {
        this.mainAudioElement.src = this.state.mainAudio.previewUrl;
      }
    } else if (this.mainAudioElement) {
      this.mainAudioElement.pause();
      this.mainAudioElement.removeAttribute("src");
      this.mainAudioElement.load();
      this.mainAudioElement = null;
    }

    this.syncLiveAudioBands();
    this.refreshVideoFrameReadyListeners();
  }

  private refreshVideoFrameReadyListeners() {
    const scheduleDraw = this.videoFrameReadyListener;
    this.clearVideoFrameReadyListeners();
    if (!scheduleDraw) {
      return;
    }

    for (const element of this.mediaRefs.values()) {
      if (!(element instanceof HTMLVideoElement)) {
        continue;
      }

      const handleFrameReady = () => scheduleDraw();
      element.addEventListener("seeked", handleFrameReady);
      element.addEventListener("loadeddata", handleFrameReady);
      this.removeVideoFrameReadyListeners.push(() => {
        element.removeEventListener("seeked", handleFrameReady);
        element.removeEventListener("loadeddata", handleFrameReady);
      });
    }
  }

  private clearVideoFrameReadyListeners() {
    for (const removeListener of this.removeVideoFrameReadyListeners) {
      removeListener();
    }
    this.removeVideoFrameReadyListeners = [];
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
    projectDurationFrames,
    isPlaying,
    isScrubbing,
    isAudibleScrubbing,
    isContinuousScrubbing,
    canvasWidth,
    canvasHeight,
    playheadSeconds,
    playheadSignal,
    mainAudio,
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
      projectDurationFrames,
      canvasWidth,
      canvasHeight,
      mainAudio,
      hiddenTextClipId,
    }),
    [
      bpm,
      canvasHeight,
      canvasWidth,
      clips,
      effects,
      fps,
      hiddenTextClipId,
      lanes,
      mainAudio,
      mediaItems,
      projectDurationFrames,
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
  const scrubStateRef = useRef({
    isScrubbing,
    isAudibleScrubbing,
    isContinuousScrubbing,
  });
  scrubStateRef.current = {
    isScrubbing,
    isAudibleScrubbing,
    isContinuousScrubbing,
  };

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
    if (!isPlayingRef.current) {
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
        ...scrubStateRef.current,
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
