import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  disposeWebGlResources,
  drawComposition,
  ensureWebGlResources,
  type FrameContext,
  type WebGlResources,
} from "./composition-draw.ts";
import {
  type ActiveClip,
  type ArrangementClip,
  computeActiveClips,
  GROUP_TRACK_ID,
  type Lane,
  type MediaItem,
  quartersToSeconds,
  type SessionEffect,
} from "./composition-active-clips.ts";
import { getGroupClipProgress } from "./composition-progress.ts";
import {
  LiveAudioBands,
  OfflineAudioBands,
  SILENT_AUDIO_BANDS,
} from "./fx-shaders/audio-bands.ts";
import {
  isChainEffectName,
  resolveEffectChain,
} from "./fx-shaders/registry.ts";
import { getRenderedEffects } from "./fx-stack.ts";

type CompositionPlayerProps = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
  playheadQ: number;
  bpm: number;
  isPlaying: boolean;
  isScrubbing: boolean;
  isAudibleScrubbing: boolean;
  isContinuousScrubbing: boolean;
  canvasWidth: number;
  canvasHeight: number;
  playheadSeconds: number;
  masterAudio?: MediaItem;
};

export type CompositionRendererState = {
  mediaItems: MediaItem[];
  clips: ArrangementClip[];
  lanes: Lane[];
  effects: SessionEffect[];
  bpm: number;
  canvasWidth: number;
  canvasHeight: number;
  masterAudio?: MediaItem;
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
  restorePreviewSurface(
    playheadQ: number,
    playheadSeconds: number,
  ): Promise<void>;
};

const MAX_DRIFT_SECONDS = 0.18;
const MEDIA_SEEK_TOLERANCE_SECONDS = 0.001;
const MEDIA_SEEK_TIMEOUT_MS = 4000;
const SCRUB_AUDIO_DRIFT_SECONDS = 0.035;
// Audio keeps playing through a scrub started during playback, so it only
// re-syncs once it falls this far behind or ahead of the playhead.
const CONTINUOUS_SCRUB_AUDIO_DRIFT_SECONDS = 0.1;

function syncCanvasSurface(
  canvas: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  pixelRatio: number,
) {
  const nextWidth = Math.max(1, Math.floor(canvasWidth * pixelRatio));
  const nextHeight = Math.max(1, Math.floor(canvasHeight * pixelRatio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  canvas.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;
}

function seekMediaElement(element: HTMLMediaElement, targetSeconds: number) {
  const clampedTarget = Math.max(0, targetSeconds);
  const drift = Math.abs(element.currentTime - clampedTarget);
  if (drift <= MEDIA_SEEK_TOLERANCE_SECONDS) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId = 0;

    const settle = () => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      element.removeEventListener("seeked", settle);
      element.removeEventListener("error", settle);
      element.removeEventListener("loadeddata", settle);
      resolve();
    };

    timeoutId = window.setTimeout(settle, MEDIA_SEEK_TIMEOUT_MS);
    element.addEventListener("seeked", settle, { once: true });
    element.addEventListener("error", settle, { once: true });
    element.addEventListener("loadeddata", settle, { once: true });

    try {
      element.pause();
      element.currentTime = clampedTarget;
    } catch {
      settle();
    }
  });
}

// "live" reads the master audio element as it plays (preview). "offline"
// decodes the master audio and measures it at each rendered frame (export).
export type AudioAnalysisMode = "live" | "offline";

export class CompositionRenderer {
  readonly canvas: HTMLCanvasElement;

  private resources: WebGlResources | null = null;
  // Media elements by source key (see ActiveClip.sourceKey), and the media
  // each one plays.
  private mediaRefs = new Map<string, HTMLMediaElement>();
  private mediaIdBySourceKey = new Map<string, string>();
  private masterAudioElement: HTMLAudioElement | null = null;
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

    if (this.masterAudioElement) {
      this.masterAudioElement.pause();
      this.masterAudioElement.removeAttribute("src");
      this.masterAudioElement.load();
      this.masterAudioElement = null;
    }
  }

  renderPreviewFrame(playheadQ: number, pixelRatio: number) {
    this.ensureResources();
    this.activeClips = this.computeActiveClips(playheadQ);
    this.draw(this.activeClips, pixelRatio, {
      time: quartersToSeconds(playheadQ, this.state.bpm),
      audio:
        this.liveAudioBands?.sample(performance.now()) ?? SILENT_AUDIO_BANDS,
      groupClipProgress: this.groupClipProgressAt(playheadQ),
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

    const nextActiveClips = this.computeActiveClips(playheadQ);
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

    const audio = await this.sampleAudioBandsAt(playheadSeconds);

    if (this.masterAudioElement && this.state.masterAudio?.previewUrl) {
      this.masterAudioElement.pause();
      this.masterAudioElement.currentTime = playheadSeconds;
    }

    this.activeClips = nextActiveClips;
    this.draw(nextActiveClips, pixelRatio, {
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

    const audio = this.masterAudioElement;
    if (!audio || !this.state.masterAudio?.previewUrl) {
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

  private computeActiveClips(playheadQ: number) {
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
    );

    // Clips sharing a media at this playhead draw from extra elements, made
    // the first time they are needed.
    let addedElement = false;
    for (const entry of activeClips) {
      if (!this.mediaRefs.has(entry.sourceKey)) {
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
    return this.renderedEffects().some(
      (effect) =>
        effect.enabled !== false && isChainEffectName(effect.effectName),
    );
  }

  private async sampleAudioBandsAt(playheadSeconds: number) {
    if (this.audioAnalysis === "live") {
      return (
        this.liveAudioBands?.sample(performance.now()) ?? SILENT_AUDIO_BANDS
      );
    }

    const url = this.state.masterAudio?.previewUrl;
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

    if (this.masterAudioElement && this.usesAudioBands()) {
      this.liveAudioBands ??= new LiveAudioBands();
    }
    // Once routed through Web Audio the element must stay attached, or it
    // would go silent, so the analyser follows the element even after the
    // effects that needed it are removed.
    this.liveAudioBands?.attach(this.masterAudioElement);
  }

  private draw(
    activeClips: ActiveClip[],
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
    drawComposition(
      this.resources as WebGlResources,
      this.canvas,
      activeClips,
      this.mediaRefs,
      resolveEffectChain(this.state.effects, GROUP_TRACK_ID),
      frameContext,
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

    if (this.state.masterAudio?.previewUrl) {
      if (!this.masterAudioElement) {
        this.masterAudioElement = document.createElement("audio");
        this.masterAudioElement.crossOrigin = "anonymous";
        this.masterAudioElement.preload = "auto";
      }
      if (
        this.masterAudioElement.getAttribute("src") !==
        this.state.masterAudio.previewUrl
      ) {
        this.masterAudioElement.src = this.state.masterAudio.previewUrl;
      }
    } else if (this.masterAudioElement) {
      this.masterAudioElement.pause();
      this.masterAudioElement.removeAttribute("src");
      this.masterAudioElement.load();
      this.masterAudioElement = null;
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
    isPlaying,
    isScrubbing,
    isAudibleScrubbing,
    isContinuousScrubbing,
    canvasWidth,
    canvasHeight,
    playheadSeconds,
    masterAudio,
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
      canvasWidth,
      canvasHeight,
      masterAudio,
    }),
    [
      bpm,
      canvasHeight,
      canvasWidth,
      clips,
      effects,
      lanes,
      masterAudio,
      mediaItems,
    ],
  );
  const rendererStateRef = useRef(rendererState);
  rendererStateRef.current = rendererState;

  const drawCurrentFrame = useCallback(
    (pixelRatio: number) => {
      const renderer = rendererRef.current;
      if (!renderer) {
        return;
      }

      renderer.renderPreviewFrame(playheadQ, pixelRatio);
    },
    [playheadQ],
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
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

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
      restorePreviewSurface: (nextPlayheadQ, nextPlayheadSeconds) =>
        renderFrameAt(
          nextPlayheadQ,
          nextPlayheadSeconds,
          window.devicePixelRatio || 1,
        ),
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
      if (!canvasRef.current || !rendererRef.current) {
        return;
      }

      drawCurrentFrame(pixelRatio);
      if (isPlaying) {
        playbackFrameRef.current = window.requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (playbackFrameRef.current) {
        window.cancelAnimationFrame(playbackFrameRef.current);
      }
    };
  }, [drawCurrentFrame, isPlaying]);

  useEffect(() => {
    return rendererRef.current?.addVideoFrameReadyListeners(scheduleDraw);
  }, [scheduleDraw]);

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
