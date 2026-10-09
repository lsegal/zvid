import {
  PauseIcon,
  PlayIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { formatMediaTime } from "../app/media-preview.ts";
import {
  describeMediaAvailability,
  describePreviewMediaState,
} from "../clip-media-state";
import {
  MEDIA_FRAME_ID,
  previewFrameAnalysis,
  publishFrame,
} from "../fx-shaders/frame-analysis.ts";
import { useAudioClipPeaks } from "../hooks/useAudioClipPeaks.ts";
import type { MediaItem } from "../media";
import type { MediaRangePoint } from "../media-range.ts";
import type { TimeValueFormat } from "../time-value.ts";
import { WaveformCanvas } from "../WaveformCanvas";
import {
  type MediaRangeActions,
  MediaRangeBar,
  MediaRangeControls,
} from "./MediaRangeBar";
import "./media-preview.css";

type MediaPreviewProps = {
  media: MediaItem | undefined;
  isPlaying: boolean;
  setPlaying: (playing: boolean) => void;
  timeFormat: TimeValueFormat;
  volume: { volume: number; muted: boolean };
  projectFps: number;
  mediaRange: MediaRangeActions;
  // Told about the player's media element, for the audio analysis pane.
  onMediaElement?: (element: HTMLMediaElement | null) => void;
  // The Scopes pane, over the bottom of the picture, when it is open.
  scopes?: ReactNode;
};

// The Media tab's player: the selected media on its own, with a transport
// under the picture, separate from the timeline's program output.
export function MediaPreview({
  media,
  isPlaying,
  setPlaying,
  timeFormat,
  volume,
  projectFps,
  mediaRange,
  onMediaElement,
  scopes,
}: MediaPreviewProps) {
  if (!media) {
    return (
      <div className="media-preview media-preview--empty">
        <span>Select media to preview</span>
        {scopes}
      </div>
    );
  }

  const state = describeMediaAvailability(media.availability);
  if (state !== "online") {
    const { title, detail } = describePreviewMediaState(state);
    return (
      <div className="media-preview" data-media-state={state}>
        <div className="preview-placeholder">
          <div className="preview-placeholder__overlay">
            <strong>{title.replace("clip", "media")}</strong>
            <span>{detail}</span>
          </div>
        </div>
        {scopes}
      </div>
    );
  }

  return (
    <MediaPlayer
      // A new element per media resets its time and buffered state.
      key={media.id}
      media={media}
      isPlaying={isPlaying}
      setPlaying={setPlaying}
      timeFormat={timeFormat}
      volume={volume}
      projectFps={projectFps}
      mediaRange={mediaRange}
      onMediaElement={onMediaElement}
      scopes={scopes}
    />
  );
}

function MediaPlayer({
  media,
  isPlaying,
  setPlaying,
  timeFormat,
  volume,
  projectFps,
  mediaRange,
  onMediaElement,
  scopes,
}: MediaPreviewProps & { media: MediaItem }) {
  const elementRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(media.durationSeconds);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    if (!isPlaying) {
      element.pause();
      return;
    }
    element.play().catch(() => setPlaying(false));

    // `timeupdate` only fires a few times a second; follow every frame so
    // the playhead moves smoothly.
    let frame = requestAnimationFrame(function follow() {
      setCurrentTime(element.currentTime);
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, setPlaying]);

  // The element is fixed for the player's life (it is keyed by media).
  useEffect(() => {
    onMediaElement?.(elementRef.current);
    return () => onMediaElement?.(null);
  }, [onMediaElement]);

  // The Scopes pane reads the picture while it is open: each frame while
  // playing, and after a seek or a frame request while paused.
  useEffect(() => {
    const element = elementRef.current;
    if (!(element instanceof HTMLVideoElement)) {
      return;
    }
    const sample = () =>
      publishFrame(previewFrameAnalysis, MEDIA_FRAME_ID, element);
    let frame = 0;
    const follow = () => {
      sample();
      frame = element.paused ? 0 : requestAnimationFrame(follow);
    };
    const play = () => {
      cancelAnimationFrame(frame);
      follow();
    };
    const events = ["loadeddata", "seeked", "playing"] as const;
    for (const type of events) {
      element.addEventListener(type, play);
    }
    const stopRequests = previewFrameAnalysis.onFrameRequest(sample);
    return () => {
      cancelAnimationFrame(frame);
      stopRequests();
      for (const type of events) {
        element.removeEventListener(type, play);
      }
    };
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (element) {
      element.volume = volume.volume;
      element.muted = volume.muted;
    }
  }, [volume.muted, volume.volume]);

  const seek = useCallback((seconds: number) => {
    const element = elementRef.current;
    if (element) {
      element.currentTime = seconds;
    }
    setCurrentTime(seconds);
  }, []);

  const mediaEvents = {
    src: media.previewUrl,
    preload: "auto",
    onLoadedMetadata: (event: { currentTarget: HTMLMediaElement }) => {
      const { duration } = event.currentTarget;
      if (Number.isFinite(duration) && duration > 0) {
        setDuration(duration);
      }
    },
    onTimeUpdate: (event: { currentTarget: HTMLMediaElement }) =>
      setCurrentTime(event.currentTarget.currentTime),
    onEnded: () => setPlaying(false),
  };
  const setRangePoint = (point: MediaRangePoint, seconds: number) =>
    mediaRange.setPoint(media.id, point, seconds);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    // Focusable so a click on the picture scopes the I/O keys to this tab.
    <div className="media-preview" data-media-kind={media.kind} tabIndex={-1}>
      <div className="media-preview__picture">
        {media.hasVideo ? (
          <video
            ref={(element) => {
              elementRef.current = element;
            }}
            className="media-preview__video"
            playsInline
            {...mediaEvents}
          />
        ) : (
          <>
            <audio
              ref={(element) => {
                elementRef.current = element;
              }}
              {...mediaEvents}
            />
            <MediaWaveform media={media} duration={duration} />
          </>
        )}
        {scopes}
      </div>

      <div className="media-preview__transport">
        <button
          type="button"
          className="media-preview__play"
          aria-label={isPlaying ? "Pause media" : "Play media"}
          title={isPlaying ? "Pause media" : "Play media"}
          onClick={() => setPlaying(!isPlaying)}
        >
          {isPlaying ? (
            <PauseIcon aria-hidden="true" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
        </button>
        <MediaRangeBar
          media={media}
          duration={duration}
          projectFps={projectFps}
          onSetPoint={setRangePoint}
          onSeek={seek}
        >
          <input
            type="range"
            className="media-preview__scrub"
            aria-label="Media position"
            min={0}
            max={duration}
            step="any"
            value={Math.min(currentTime, duration)}
            style={{ "--progress": `${progress * 100}%` } as CSSProperties}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
        </MediaRangeBar>
        <span className="media-preview__time" data-testid="media-preview-time">
          {formatMediaTime(currentTime, timeFormat)} /{" "}
          {formatMediaTime(duration, timeFormat)}
        </span>
      </div>
      <MediaRangeControls
        media={media}
        currentTime={currentTime}
        timeFormat={timeFormat}
        onSetPoint={setRangePoint}
        onClear={() => mediaRange.clear(media.id)}
      />
    </div>
  );
}

// Audio-only media draws its whole waveform, or a speaker glyph until (or
// unless) its peaks decode.
function MediaWaveform({
  media,
  duration,
}: {
  media: MediaItem;
  duration: number;
}) {
  const peaks = useAudioClipPeaks(media, "audio");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(() => setWidth(container.clientWidth));
    observer.observe(container);
    setWidth(container.clientWidth);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="media-preview__audio">
      {peaks.status === "ready" && width > 0 && duration > 0 ? (
        <WaveformCanvas
          className="media-preview__waveform"
          peaks={peaks.peaks}
          range={{ startSeconds: 0, secondsPerPx: duration / width }}
          startPx={0}
          widthPx={width}
        />
      ) : (
        <SpeakerWaveIcon
          className="media-preview__glyph"
          aria-hidden="true"
          data-testid="media-preview-glyph"
        />
      )}
    </div>
  );
}
