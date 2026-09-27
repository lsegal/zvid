import { useEffect, useRef, useState } from "react";
import { formatDuration, formatTakeDate } from "../format.ts";
import type { TakeInfo } from "../ipc/types.ts";
import {
  clampPosition,
  clockPosition,
  needsHostFrames,
  resumePosition,
} from "../playback.ts";
import { Close, Pause, Play } from "./icons.tsx";
import { Spinner, StatusDot } from "./Status.tsx";

type Props = {
  take: TakeInfo;
  /** The take's file, played by the webview when it can decode it. */
  src: string;
  /** A host-decoded frame `offsetSec` into the file, as an object URL. */
  loadFrame: (offsetSec: number, signal: AbortSignal) => Promise<string>;
  onClose: () => void;
};

/**
 * Plays one take in a modal, limited to the take's range of its file. When
 * the webview can't decode the take, the host decodes frames instead.
 */
export function TakePreview({ take, src, loadFrame, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<"video" | "host">("video");
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const start = take.fileOffsetSec;
  const duration = take.durationSec;
  const date = formatTakeDate(take.createdAt);

  useEffect(() => {
    // Unmounting takes the dialog out of the top layer; closing it here
    // would fire `close` and dismiss a remounted preview.
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  const clock = useRef({ fromSec: 0, atMs: 0 });
  const restartClock = (fromSec: number) => {
    clock.current = { fromSec, atMs: performance.now() };
  };

  // Host frames: advance the playhead on a clock while playing.
  useEffect(() => {
    if (source !== "host" || !playing) return;
    let frame = requestAnimationFrame(function tick(now) {
      const next = clockPosition(
        clock.current.fromSec,
        now - clock.current.atMs,
        duration,
      );
      setPosition(next);
      if (next >= duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [source, playing, duration]);

  const toggle = () => {
    if (playing) {
      if (source === "video") video.current?.pause();
      setPlaying(false);
      return;
    }
    const from = resumePosition(position, duration);
    if (source === "video" && video.current) {
      if (from !== position) video.current.currentTime = start + from;
      void video.current.play().catch(() => setPlaying(false));
    } else {
      restartClock(from);
    }
    setPosition(from);
    setPlaying(true);
  };

  const seek = (to: number) => {
    const next = clampPosition(to, duration);
    if (source === "video" && video.current) {
      video.current.currentTime = start + next;
    } else {
      restartClock(next);
    }
    setPosition(next);
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog natively; the click is for the backdrop
    <dialog
      ref={dialog}
      className="take-preview"
      aria-labelledby="take-preview-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="take-preview-body">
        <header className="take-preview-header">
          <h2 id="take-preview-title">Take from {date}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close preview"
            onClick={() => dialog.current?.close()}
          >
            <Close />
          </button>
        </header>
        <div className="take-preview-media">
          {failure ? (
            <p className="take-preview-message" role="alert">
              <StatusDot tone="warning" />
              {failure}
            </p>
          ) : source === "video" ? (
            // biome-ignore lint/a11y/useMediaCaption: takes are camera video; their sound is in the Live set
            <video
              ref={video}
              className="take-preview-video"
              src={`${src}#t=${start},${start + duration}`}
              autoPlay
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                const element = event.currentTarget;
                const at = element.currentTime - start;
                if (at >= duration && !element.paused) element.pause();
                setPosition(clampPosition(at, duration));
              }}
              onError={(event) => {
                if (needsHostFrames(event.currentTarget.error?.code)) {
                  restartClock(position);
                  setPlaying(true);
                  setSource("host");
                } else {
                  setFailure("This take couldn't be loaded.");
                }
              }}
            />
          ) : (
            <HostFrames
              positionSec={start + position}
              loadFrame={loadFrame}
              onError={(message) => setFailure(message)}
            />
          )}
        </div>
        <div className="take-preview-controls">
          <button
            type="button"
            className="icon-button"
            aria-label={playing ? "Pause" : "Play"}
            // biome-ignore lint/a11y/noAutofocus: the modal's main action takes focus when it opens
            autoFocus
            aria-disabled={failure !== null}
            onClick={() => {
              if (failure === null) toggle();
            }}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <input
            type="range"
            className="take-preview-seek"
            aria-label="Playhead"
            min={0}
            max={duration}
            step={0.01}
            value={position}
            disabled={failure !== null}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
          <span className="mono take-preview-time">
            {formatDuration(position)} / {formatDuration(duration)}
          </span>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Shows the host-decoded frame nearest `positionSec`, asking for the next
 * one as soon as the last has arrived.
 */
function HostFrames({
  positionSec,
  loadFrame,
  onError,
}: {
  positionSec: number;
  loadFrame: Props["loadFrame"];
  onError: (message: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const wanted = useRef(positionSec);
  wanted.current = positionSec;
  const callbacks = useRef({ loadFrame, onError });
  callbacks.current = { loadFrame, onError };

  useEffect(() => {
    const controller = new AbortController();
    let shown: string | null = null;
    let loaded: number | null = null;
    const idle = () => new Promise((resolve) => setTimeout(resolve, 16));
    void (async () => {
      while (!controller.signal.aborted) {
        const at = wanted.current;
        if (at === loaded) {
          await idle();
          continue;
        }
        try {
          const next = await callbacks.current.loadFrame(at, controller.signal);
          if (controller.signal.aborted) {
            URL.revokeObjectURL(next);
            return;
          }
          if (shown) URL.revokeObjectURL(shown);
          shown = next;
          loaded = at;
          setUrl(next);
        } catch (error) {
          if (controller.signal.aborted) return;
          callbacks.current.onError(
            error instanceof Error
              ? `This take couldn't be decoded: ${error.message}`
              : "This take couldn't be decoded.",
          );
          return;
        }
      }
    })();
    return () => {
      controller.abort();
      if (shown) URL.revokeObjectURL(shown);
    };
  }, []);

  return url ? (
    <img className="take-preview-video" src={url} alt="" />
  ) : (
    <p className="take-preview-message">
      <Spinner />
      Loading take…
    </p>
  );
}
