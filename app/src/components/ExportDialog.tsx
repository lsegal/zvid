import {
  ArrowPathRoundedSquareIcon,
  BackwardIcon,
  ForwardIcon,
  PauseIcon,
  PlayIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { canEncodeVideo } from "mediabunny";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getClipEndQ,
  quartersToSeconds,
  secondsToQuarters,
} from "../app/timeline-math.ts";
import { isAudibleMix } from "../audio-mix/mix.ts";
import { CompositionPlayer } from "../CompositionPlayer";
import {
  type ExportOptions,
  type ExportRange,
  estimateExportBytes,
  exportTiming,
  formatFileSize,
  formatMusicalLength,
  frameQuarters,
  hasExportOptionsErrors,
  modifiedExportFields,
  moveExportMarker,
  parseTimecode,
  projectDurationAt,
  resetExportSettings,
  snapToFrame,
  validateExportOptions,
} from "../export-options.ts";
import { formatSnapshotTime } from "../export-progress.ts";
import { MEDIABUNNY_VIDEO_CODECS } from "../harness/export-encoding.ts";
import type { ExportDialogModel } from "../hooks/useExport.ts";
import {
  createPlayheadSignal,
  PLAYBACK_COMMIT_INTERVAL_MS,
} from "../playhead-signal";
import {
  DEFAULT_SESSION_SETTINGS,
  type EncodableVideoCodec,
  type VideoCodecSupport,
  videoBitrateMbps,
} from "../session-settings.ts";
import { isTextEntryTarget } from "../space-shortcut.ts";
import { formatMusicalPosition, formatTimecode } from "../timeline-format.ts";
import { ExportRangeTimeline } from "./ExportRangeTimeline";
import { ExportSettingsForm } from "./ExportSettingsForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import "./export-dialog.css";

const PROBED_CODECS: readonly EncodableVideoCodec[] = [
  "h264",
  "hevc",
  "av1",
  "vp8",
  "vp9",
];

// Which codecs this device can encode at the export's size and bitrate,
// checked again (after a pause) whenever those change.
function useVideoCodecSupport(options: ExportOptions, valid: boolean) {
  const [support, setSupport] = useState<VideoCodecSupport>({});
  const width = options.canvasWidth;
  const height = options.canvasHeight;
  const bitrate = valid ? Math.round(videoBitrateMbps(options) * 1e6) : 0;
  useEffect(() => {
    if (!valid || !bitrate) {
      return;
    }
    let canceled = false;
    const timeout = window.setTimeout(async () => {
      const next: VideoCodecSupport = {};
      for (const codec of PROBED_CODECS) {
        next[codec] = await canEncodeVideo(MEDIABUNNY_VIDEO_CODECS[codec], {
          width,
          height,
          bitrate,
        }).catch(() => false);
      }
      if (!canceled) {
        setSupport(next);
      }
    }, 150);
    return () => {
      canceled = true;
      window.clearTimeout(timeout);
    };
  }, [bitrate, height, valid, width]);
  return support;
}

// The dialog's own transport: plays the composite from In to Out, looping
// back to In when looping is on, without touching the editor's playhead.
function useRangePlayback(range: ExportRange, bpm: number) {
  const [signal] = useState(() => createPlayheadSignal(range.inQ));
  const [playheadQ, setPlayheadQState] = useState(range.inQ);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  // Set by a seek during playback so the clock restarts from there.
  const seekedRef = useRef(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    let frame = 0;
    let originQ = signal.get();
    let startedAt = performance.now();
    let committedAt = startedAt;
    const step = (timestamp: number) => {
      const { inQ, outQ } = rangeRef.current;
      if (seekedRef.current) {
        seekedRef.current = false;
        originQ = signal.get();
        startedAt = timestamp;
      }
      const nextQ =
        originQ + secondsToQuarters((timestamp - startedAt) / 1000, bpm);
      if (nextQ >= outQ) {
        if (!loopRef.current) {
          signal.set(outQ);
          setPlayheadQState(outQ);
          setIsPlaying(false);
          return;
        }
        originQ = inQ;
        startedAt = timestamp;
        committedAt = timestamp;
        signal.set(inQ);
        setPlayheadQState(inQ);
      } else {
        signal.set(nextQ);
        if (timestamp - committedAt >= PLAYBACK_COMMIT_INTERVAL_MS) {
          setPlayheadQState(nextQ);
          committedAt = timestamp;
        }
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(frame);
      setPlayheadQState(signal.get());
    };
  }, [bpm, isPlaying, signal]);

  function seek(q: number) {
    signal.set(q);
    setPlayheadQState(q);
    seekedRef.current = isPlaying;
  }

  function play() {
    const { inQ, outQ } = rangeRef.current;
    const q = signal.get();
    if (q < inQ || q >= outQ - 1e-6) {
      seek(inQ);
    }
    setIsPlaying(true);
  }

  function toggle() {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      play();
    }
  }

  return {
    signal,
    playheadQ,
    isPlaying,
    setIsPlaying,
    loop,
    setLoop,
    seek,
    toggle,
  };
}

function isFieldTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, select, textarea, button, [role=slider]"))
  );
}

type TimecodeFieldProps = {
  label: string;
  seconds: number;
  fps: number;
  disabled: boolean;
  onCommit(seconds: number): void;
};

// A typed In or Out, as `mm:ss:ff` (or plain seconds).
function TimecodeField({
  label,
  seconds,
  fps,
  disabled,
  onCommit,
}: TimecodeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft !== null) {
      const parsed = parseTimecode(draft, fps);
      if (parsed !== undefined) {
        onCommit(parsed);
      }
    }
    setDraft(null);
  }
  return (
    <label className="export-range-field">
      <span>{label}</span>
      <input
        aria-label={`${label} timecode`}
        disabled={disabled}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        spellCheck={false}
        type="text"
        value={draft ?? formatTimecode(seconds, fps)}
      />
    </label>
  );
}

export function ExportDialog({ model }: { model: ExportDialogModel }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const exporting = model.phase === "exporting";

  useEffect(() => {
    if (!exporting) {
      setConfirmCancel(false);
    }
  }, [exporting]);

  return (
    <Dialog
      open={model.open}
      onOpenChange={(open) => {
        if (!open) {
          model.close();
        }
      }}
    >
      <DialogContent
        aria-describedby="export-dialog-description"
        className="export-dialog"
        // Esc and, mid-export, an outside click hide the dialog; a running
        // export keeps going in the background.
        onInteractOutside={(event) => {
          if (!exporting) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          // Focus the dialog itself, so Space, I and O work right away.
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLElement>(".export-dialog__body")
            ?.focus();
        }}
        ref={contentRef}
      >
        {model.open ? (
          <ExportDialogBody
            confirmCancel={confirmCancel}
            model={model}
            setConfirmCancel={setConfirmCancel}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type ExportDialogBodyProps = {
  model: ExportDialogModel;
  confirmCancel: boolean;
  setConfirmCancel(confirm: boolean): void;
};

function ExportDialogBody({
  model,
  confirmCancel,
  setConfirmCancel,
}: ExportDialogBodyProps) {
  const { options, setOptions, session, bpm, signature, phase } = model;
  const editing = phase === "editing";
  const exporting = phase === "exporting";
  const playback = useRangePlayback(options, bpm);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const errors = validateExportOptions(options, bpm);
  const sizeValid = !errors.canvasWidth && !errors.canvasHeight;
  const support = useVideoCodecSupport(options, sizeValid && !errors.bitrate);
  const allErrors = validateExportOptions(options, bpm, support);
  const modified = modifiedExportFields(options, session);
  const timing = exportTiming(options, bpm);
  const minimumQ = frameQuarters(options.fps, bpm);
  // The preview keeps the last valid size while a size is being typed.
  const previewWidth = sizeValid
    ? options.canvasWidth
    : session.canvasWidth || DEFAULT_SESSION_SETTINGS.canvasWidth;
  const previewHeight = sizeValid
    ? options.canvasHeight
    : session.canvasHeight || DEFAULT_SESSION_SETTINGS.canvasHeight;
  const previewFps = errors.fps ? session.fps : options.fps;
  const contentEndQ = Math.max(
    model.defaultRange.outQ,
    ...model.clips.map((clip) => getClipEndQ(clip, bpm)),
    ...model.audioMix.clips.map((clip) =>
      secondsToQuarters(clip.startSeconds + clip.durationSeconds, bpm),
    ),
  );
  const totalQ = Math.max(contentEndQ, options.outQ);

  // Exporting and closing stop the dialog's playback.
  const { setIsPlaying } = playback;
  useEffect(() => {
    if (!editing) {
      setIsPlaying(false);
    }
  }, [editing, setIsPlaying]);

  function setRange(range: ExportRange) {
    setOptions((current) => ({ ...current, ...range }));
  }

  function setMarkerAt(marker: "in" | "out", q: number) {
    setRange(moveExportMarker(options, marker, q, minimumQ));
  }

  function stepFrame(direction: -1 | 1) {
    playback.setIsPlaying(false);
    const q = snapToFrame(playback.signal.get(), options.fps, bpm);
    playback.seek(Math.min(totalQ, Math.max(0, q + direction * minimumQ)));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // The editor's shortcuts stay out of the dialog.
    event.stopPropagation();
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isTextEntryTarget(event.target) ||
      !editing
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (event.code === "Space") {
      event.preventDefault();
      playback.toggle();
    } else if (key === "i") {
      event.preventDefault();
      setMarkerAt("in", snapToFrame(playback.signal.get(), options.fps, bpm));
    } else if (key === "o") {
      event.preventDefault();
      setMarkerAt("out", snapToFrame(playback.signal.get(), options.fps, bpm));
    } else if (
      key === "enter" &&
      !isFieldTarget(event.target) &&
      !hasExportOptionsErrors(allErrors)
    ) {
      event.preventDefault();
      model.startExport();
    }
  }

  function onKeyUp(event: ReactKeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    // A focused button would also click on Space's release.
    if (event.code === "Space" && !isTextEntryTarget(event.target)) {
      event.preventDefault();
    }
  }

  const position = (q: number) =>
    `${formatMusicalPosition(q, signature)} · ${formatTimecode(
      quartersToSeconds(q, bpm),
      options.fps,
    )}`;
  const rangeLengthQ = options.outQ - options.inQ;
  const estimate = estimateExportBytes(
    options,
    timing.durationSeconds,
    isAudibleMix(model.audioMix),
  );
  const progress = model.progress?.progress ?? null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the dialog's keyboard shortcuts.
    <div
      className="export-dialog__body"
      data-space-playback=""
      data-playhead-q={playback.playheadQ}
      data-playing={playback.isPlaying ? "true" : "false"}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      tabIndex={-1}
    >
      <DialogHeader>
        <button
          aria-label="Dismiss dialog"
          className="export-dialog__dismiss"
          onClick={model.close}
          title={
            exporting ? "Hide; the export keeps running (Esc)" : "Close (Esc)"
          }
          type="button"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
        <DialogTitle>Export</DialogTitle>
        <DialogDescription id="export-dialog-description">
          Choose the range to export and adjust the output for this export.
          Session Settings stay unchanged.
        </DialogDescription>
      </DialogHeader>

      <div className="export-dialog__main">
        <div className="export-dialog__preview-column">
          <div className="export-dialog__preview">
            <CompositionPlayer
              bpm={bpm}
              canvasHeight={previewHeight}
              canvasWidth={previewWidth}
              clips={model.clips}
              effects={model.effects}
              fps={previewFps}
              isAudibleScrubbing={false}
              isContinuousScrubbing={false}
              isPlaying={playback.isPlaying}
              isScrubbing={isScrubbing}
              lanes={model.lanes}
              audioMix={model.audioMix}
              mediaItems={model.mediaItems}
              playheadSignal={playback.signal}
              projectDurationFrames={projectDurationAt(
                model.projectDurationFrames,
                session.fps,
                previewFps,
              )}
            />
          </div>

          <div className="export-dialog__transport">
            <button
              aria-label="Jump to In"
              className="transport-button transport-button--skip-start"
              disabled={!editing}
              onClick={() => playback.seek(options.inQ)}
              title="Jump to In"
              type="button"
            >
              <BackwardIcon aria-hidden="true" />
            </button>
            <button
              aria-label="Step back one frame"
              className="transport-button export-dialog__step"
              disabled={!editing}
              onClick={() => stepFrame(-1)}
              title="Step back one frame"
              type="button"
            >
              −1
            </button>
            <button
              aria-label={playback.isPlaying ? "Pause" : "Play"}
              className="transport-button transport-button--primary"
              disabled={!editing}
              onClick={playback.toggle}
              title={playback.isPlaying ? "Pause (Space)" : "Play (Space)"}
              type="button"
            >
              {playback.isPlaying ? (
                <PauseIcon aria-hidden="true" />
              ) : (
                <PlayIcon aria-hidden="true" />
              )}
            </button>
            <button
              aria-label="Step forward one frame"
              className="transport-button export-dialog__step"
              disabled={!editing}
              onClick={() => stepFrame(1)}
              title="Step forward one frame"
              type="button"
            >
              +1
            </button>
            <button
              aria-label="Jump to Out"
              className="transport-button transport-button--skip-end"
              disabled={!editing}
              onClick={() => playback.seek(options.outQ)}
              title="Jump to Out"
              type="button"
            >
              <ForwardIcon aria-hidden="true" />
            </button>
            <button
              aria-label="Loop In to Out"
              aria-pressed={playback.loop}
              className={`transport-button export-dialog__loop${
                playback.loop ? " export-dialog__loop--on" : ""
              }`}
              disabled={!editing}
              onClick={() => playback.setLoop(!playback.loop)}
              title="Loop In to Out"
              type="button"
            >
              <ArrowPathRoundedSquareIcon aria-hidden="true" />
            </button>
          </div>

          <dl className="export-dialog__readout">
            <div>
              <dt>Position</dt>
              <dd data-export-readout="position">
                {position(playback.playheadQ)}
              </dd>
            </div>
            <div>
              <dt>In</dt>
              <dd data-export-readout="in">{position(options.inQ)}</dd>
            </div>
            <div>
              <dt>Out</dt>
              <dd data-export-readout="out">{position(options.outQ)}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd data-export-readout="duration">
                {formatMusicalLength(rangeLengthQ, signature)} ·{" "}
                {formatTimecode(timing.durationSeconds, options.fps)}
              </dd>
            </div>
          </dl>
        </div>

        <ExportSettingsForm
          disabled={!editing}
          errors={allErrors}
          modified={modified}
          onChange={setOptions}
          onReset={() =>
            setOptions((current) => resetExportSettings(current, session))
          }
          options={options}
          support={support}
        />
      </div>

      <div className="export-dialog__range">
        <div className="export-dialog__range-fields">
          <TimecodeField
            disabled={!editing}
            fps={options.fps}
            label="In"
            onCommit={(seconds) =>
              setMarkerAt(
                "in",
                snapToFrame(secondsToQuarters(seconds, bpm), options.fps, bpm),
              )
            }
            seconds={quartersToSeconds(options.inQ, bpm)}
          />
          <TimecodeField
            disabled={!editing}
            fps={options.fps}
            label="Out"
            onCommit={(seconds) =>
              setMarkerAt(
                "out",
                snapToFrame(secondsToQuarters(seconds, bpm), options.fps, bpm),
              )
            }
            seconds={quartersToSeconds(options.outQ, bpm)}
          />
          <button
            className="export-settings__reset"
            disabled={!editing}
            onClick={() => setRange(model.defaultRange)}
            type="button"
          >
            Reset range
          </button>
          <span className="export-dialog__range-hint">
            Drag In and Out to choose the range; they snap to beats (Shift for
            frames). I and O set them at the playhead.
          </span>
        </div>
        <ExportRangeTimeline
          beatQ={model.beatUnit}
          bpm={bpm}
          clips={model.clips}
          fps={options.fps}
          lanes={model.lanes}
          audioPeaks={model.audioPeaks}
          mediaItems={model.mediaItems}
          minimumQ={minimumQ}
          onRangeChange={(range) => (editing ? setRange(range) : undefined)}
          onScrub={(q) => {
            playback.setIsPlaying(false);
            playback.seek(q);
          }}
          onScrubbingChange={setIsScrubbing}
          playheadQ={playback.playheadQ}
          range={options}
          totalQ={totalQ}
        />
        {allErrors.range ? (
          <small className="export-settings__error" role="alert">
            {allErrors.range}
          </small>
        ) : null}
      </div>

      {exporting ? (
        <div className="export-dialog__progress">
          <div
            aria-label="Export progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress ?? undefined}
            className={`export-dialog__bar${
              progress === null ? " export-dialog__bar--indeterminate" : ""
            }`}
            role="progressbar"
          >
            <span style={{ width: `${progress ?? 100}%` }} />
          </div>
          <span className="export-dialog__detail">
            {model.progress?.detail ?? "Preparing export..."}
          </span>
        </div>
      ) : null}

      {model.snapshotTakenAt && phase !== "editing" ? (
        <p className="export-dialog__snapshot" data-export-snapshot="">
          {exporting
            ? `Exporting the version from ${formatSnapshotTime(
                model.snapshotTakenAt,
              )}. Edits made since don't change this export, and you can hide this dialog and keep working.`
            : `Exported the version from ${formatSnapshotTime(
                model.snapshotTakenAt,
              )}.`}
        </p>
      ) : null}

      {model.message ? (
        <p
          className={`export-dialog__message${
            phase === "done" ? "" : " export-dialog__message--error"
          }`}
          role="status"
        >
          {model.message}
        </p>
      ) : null}

      {confirmCancel && exporting ? (
        <div className="export-dialog__confirm" role="alertdialog">
          <span>Cancel the export in progress?</span>
          <button
            className="ghost-button"
            onClick={() => setConfirmCancel(false)}
            type="button"
          >
            Keep exporting
          </button>
          <button
            className="ghost-button ghost-button--accent"
            onClick={() => {
              setConfirmCancel(false);
              model.cancelExport();
            }}
            type="button"
          >
            Stop export
          </button>
        </div>
      ) : null}

      <DialogFooter className="export-dialog__footer">
        <span className="export-dialog__estimate" data-export-estimate="">
          ≈ {formatFileSize(estimate)} ·{" "}
          {formatTimecode(timing.durationSeconds, options.fps)} (
          {timing.frameCount} frames)
        </span>
        {exporting ? (
          <>
            <button
              className="ghost-button"
              disabled={confirmCancel}
              onClick={() => setConfirmCancel(true)}
              type="button"
            >
              Cancel export
            </button>
            <button
              className="ghost-button ghost-button--accent"
              onClick={model.close}
              title="Hide this dialog; the export keeps running"
              type="button"
            >
              Run in background
            </button>
          </>
        ) : phase === "done" ? (
          <>
            {model.canReveal ? (
              <button
                className="ghost-button"
                onClick={model.revealFile}
                type="button"
              >
                Reveal file
              </button>
            ) : null}
            <button
              className="ghost-button"
              onClick={model.close}
              type="button"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <button
              className="ghost-button"
              onClick={model.close}
              type="button"
            >
              Cancel
            </button>
            <button
              className="ghost-button ghost-button--accent"
              disabled={hasExportOptionsErrors(allErrors)}
              onClick={model.startExport}
              type="button"
            >
              Export
            </button>
          </>
        )}
      </DialogFooter>
    </div>
  );
}
