import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { signatureById } from "../app/constants.ts";
import type { ExportState, ProjectState } from "../app/types.ts";
import { logClient, pluralize } from "../app/util.ts";
import { isAudibleMix } from "../audio-mix/mix.ts";
import { type AudioMix, resolveAudioClips } from "../audio-mix/resolve.ts";
import { CompositionRenderer } from "../CompositionPlayer";
import {
  createExportOptions,
  defaultExportFileName,
  defaultExportRange,
  type ExportOptions,
  type ExportRange,
  exportSettings,
  exportTiming,
  normalizeExportFileName,
  projectDurationAt,
  reopenExportOptions,
} from "../export-options.ts";
import {
  describeExportActivity,
  estimateExportSecondsLeft,
} from "../export-progress.ts";
import { canRevealSavedFile, getHarness, type SaveTarget } from "../harness";
import type { ExportProgress } from "../harness/contracts";
import type { MediaItem } from "../media";
import { retainObjectUrls } from "../object-url-retention.ts";
import { hasRenderableContent, resolveRenderClips } from "../render-clips.ts";
import {
  type SessionSettings,
  sessionSettingsFromProject,
} from "../session-settings";
import type { MeterSignature } from "../timeline-format.ts";
import type { WaveformPeaks } from "../waveform-peaks";

// While the editor plays, the export renders at most one frame per this
// many milliseconds, so preview playback stays smooth.
const PLAYING_FRAME_YIELD_MS = 32;

// Whether an export is running, its progress, and the Export button label
// that shows it. App calls this early, since App reads `isExporting`.
export function useExportState() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({
    phase: "idle",
    progress: null,
    detail: "",
  });

  function updateExportState(
    phase: ExportState["phase"],
    detail: string,
    progress: number | null = null,
  ) {
    setExportState({ phase, detail, progress });
  }

  const exportButtonLabel = isExporting
    ? exportState.progress !== null
      ? `${exportState.progress}%`
      : exportState.phase === "muxing"
        ? "Muxing..."
        : exportState.phase === "decoding-audio"
          ? "Audio..."
          : "Render..."
    : "Export";

  return {
    isExporting,
    setIsExporting,
    setExportState,
    updateExportState,
    exportButtonLabel,
  };
}

export type ExportInputs = {
  isExporting: boolean;
  setIsExporting: Dispatch<SetStateAction<boolean>>;
  setExportState: Dispatch<SetStateAction<ExportState>>;
  updateExportState: (
    phase: ExportState["phase"],
    detail: string,
    progress?: number | null,
  ) => void;
  // The session: its clips, layers, effects, tempo, length and Session
  // Settings.
  project: ProjectState;
  mediaItems: MediaItem[];
  // The Audio row's waveform of the mix, for the range strip.
  audioPeaks: WaveformPeaks | undefined;
  signature: MeterSignature;
  beatUnit: number;
  // Whether the editor's preview is playing; the export yields more
  // between frames meanwhile.
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export type ExportDialogPhase = "editing" | "exporting" | "done";

// The session as it was when an export started. The export renders only
// this, so editing meanwhile doesn't change it, and the dialog shows it
// while exporting and once done.
export type ExportSnapshot = {
  takenAt: Date;
  project: ProjectState;
  session: SessionSettings;
  defaultRange: ExportRange;
  mediaItems: MediaItem[];
  // The Audio row's waveform of the mix, for the range strip.
  audioPeaks: WaveformPeaks | undefined;
  signature: MeterSignature;
  beatUnit: number;
};

// A running export, or one that ended while the dialog was hidden, as the
// status bar and the completion notice show it.
export type ExportActivity =
  | { kind: "running"; label: string; progress: number | null }
  | { kind: "done" | "failed"; label: string };

// What the Export dialog shows and does. See ExportDialog.
export type ExportDialogModel = {
  open: boolean;
  phase: ExportDialogPhase;
  options: ExportOptions;
  setOptions: Dispatch<SetStateAction<ExportOptions>>;
  session: SessionSettings;
  defaultRange: ExportRange;
  progress: ExportProgress | null;
  // When the running (or finished) export's snapshot was taken.
  snapshotTakenAt: Date | null;
  // What the last export did, shown once it finishes or fails.
  message: string;
  // Whether the done state offers Reveal file for the saved export.
  canReveal: boolean;
  mediaItems: MediaItem[];
  clips: ProjectState["clips"];
  lanes: ProjectState["lanes"];
  effects: ProjectState["effects"];
  // What the dialog's preview plays and the export encodes.
  audioMix: AudioMix;
  // The Audio row's waveform of the mix, for the range strip.
  audioPeaks: WaveformPeaks | undefined;
  bpm: number;
  signature: MeterSignature;
  beatUnit: number;
  // The session's length in frames at its own frame rate.
  projectDurationFrames: number | undefined;
  startExport(): void;
  cancelExport(): void;
  revealFile(): void;
  // Hides the dialog. A running export keeps going in the background.
  close(): void;
};

type Remembered = {
  sessionName: string | null;
  options: ExportOptions;
  session: SessionSettings;
};

// What an export of `project` renders: its layer clips and layers, or its
// source tracks as layers when it has no layer clips, and the effects they
// render with.
function renderClipsOf(project: ProjectState) {
  return resolveRenderClips({
    clips: project.clips,
    lanes: project.lanes,
    sourceTracks: project.sourceTracks,
    sourceSpans: project.sourceSpans,
    bpm: project.bpm,
    effects: project.effects,
  });
}

// What an export of `project` hears: its layer clips with audio, or else its
// source clips with audio (see resolveAudioClips).
function audioMixOf(project: ProjectState, mediaItems: readonly MediaItem[]) {
  return resolveAudioClips({
    clips: project.clips,
    lanes: project.lanes,
    sourceTracks: project.sourceTracks,
    sourceSpans: project.sourceSpans,
    mediaById: new Map(mediaItems.map((item) => [item.id, item])),
    bpm: project.bpm,
    signature: signatureById(project.signatureId),
    effects: project.effects,
  });
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

// Closing the window mid-export asks first, since it would cancel it.
function useConfirmCloseWhileExporting(isExporting: boolean) {
  useEffect(() => {
    if (!isExporting) {
      return;
    }
    return getHarness().guardWindowClose?.(
      "An export is still running. Closing the window cancels it. Close anyway?",
    );
  }, [isExporting]);
}

// Export opens the Export dialog, where the In→Out range and the settings
// are chosen; the dialog's Export renders that range to an MP4 and saves it.
// The export runs in the background: the dialog can be hidden and reopened
// meanwhile, and the editor stays usable.
export function useExport({
  isExporting,
  setIsExporting,
  setExportState,
  updateExportState,
  project,
  mediaItems,
  audioPeaks,
  signature,
  beatUnit,
  isPlaying,
  setIsPlaying,
  setStatus,
}: ExportInputs) {
  const { sessionName } = project;
  const session = sessionSettingsFromProject(project);
  const render = renderClipsOf(project);
  const defaultRange = defaultExportRange({
    clips: render.clips,
    bpm: project.bpm,
    fps: session.fps,
    projectDurationFrames: project.projectDurationFrames,
  });
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ExportDialogPhase>("editing");
  const [options, setOptions] = useState<ExportOptions>(() =>
    createExportOptions(session, defaultRange, defaultExportFileName(null)),
  );
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [message, setMessage] = useState("");
  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | undefined>();
  // How an export that ended while the dialog was hidden went, until the
  // dialog is shown again.
  const [unseenResult, setUnseenResult] = useState<ExportActivity | null>(null);
  // Where the last successful export was saved, for Reveal file.
  const [savedTarget, setSavedTarget] = useState<SaveTarget | null>(null);
  // The options last used, kept while the app is open (not saved) so
  // reopening Export picks up where it left off.
  const rememberedRef = useRef<Remembered | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useConfirmCloseWhileExporting(isExporting);

  function openExportDialog() {
    if (isExporting) {
      return;
    }
    if (!hasRenderableContent(project)) {
      setStatus("Open a session or import media before exporting.");
      return;
    }
    const remembered = rememberedRef.current;
    setOptions(
      remembered && remembered.sessionName === sessionName
        ? reopenExportOptions(remembered.options, remembered.session, session)
        : createExportOptions(
            session,
            defaultRange,
            defaultExportFileName(sessionName),
          ),
    );
    // The dialog plays on its own; the editor's playback stops meanwhile.
    setIsPlaying(false);
    setPhase("editing");
    setProgress(null);
    setMessage("");
    setSavedTarget(null);
    setSnapshot(null);
    setUnseenResult(null);
    setOpen(true);
  }

  // Shows the dialog again as it was: a running export's progress, or how
  // the last one ended.
  const reopenExportDialog = useCallback(() => {
    setUnseenResult(null);
    setOpen(true);
  }, []);

  const dismissExportActivity = useCallback(() => setUnseenResult(null), []);

  function close() {
    if (!abortRef.current) {
      rememberedRef.current = { sessionName, options, session };
    }
    setOpen(false);
  }

  function cancelExport() {
    abortRef.current?.abort();
  }

  async function runExport(exportOptions: ExportOptions, from: ExportSnapshot) {
    const { bpm } = from.project;
    const settings = exportSettings(exportOptions);
    const { startSeconds, durationSeconds, frameCount } = exportTiming(
      exportOptions,
      bpm,
    );
    const { canvasWidth, canvasHeight, fps } = settings;
    const exportName = normalizeExportFileName(exportOptions.fileName);

    let saveTarget: SaveTarget;
    try {
      const nextSaveTarget = await getHarness().prepareSave(exportName, {
        mimeType: "video/mp4",
        extensions: [".mp4"],
        description: "MP4 video",
      });
      if (!nextSaveTarget) {
        setStatus("Export canceled before rendering.");
        return;
      }
      saveTarget = nextSaveTarget;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAbort(error)) {
        setStatus("Export canceled before rendering.");
        return;
      }

      setStatus(`Failed to prepare export destination: ${message}`);
      setMessage(`Failed to prepare export destination: ${message}`);
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;
    // Media replaced or removed in the editor meanwhile stays readable.
    const releaseMedia = retainObjectUrls(
      from.mediaItems.map((item) => item.previewUrl),
    );
    const audioMix = audioMixOf(from.project, from.mediaItems);
    let renderStartedAt: number | null = null;
    setSnapshot(from);
    setSecondsLeft(undefined);
    setPhase("exporting");
    setIsExporting(true);
    updateExportState(
      "preparing",
      `Preparing export (${pluralize(frameCount, "frame")})...`,
      null,
    );
    logClient("export:start", {
      startSeconds,
      durationSeconds,
      frameRate: fps,
      frames: frameCount,
      canvasWidth,
      canvasHeight,
      encoding: settings.encoding,
      audioClips: audioMix.clips.length,
      audibleAudio: isAudibleMix(audioMix),
    });
    logClient("export:phase", { phase: "preparing", frames: frameCount });

    // Its own canvas, WebGL context, media elements and audio analysis, so
    // the preview and the export never share renderer state.
    const rendered = renderClipsOf(from.project);
    const exportRenderer = new CompositionRenderer(
      {
        mediaItems: from.mediaItems,
        clips: rendered.clips,
        lanes: rendered.lanes,
        effects: rendered.effects,
        bpm,
        fps,
        signature: signatureById(from.project.signatureId),
        projectDurationFrames: projectDurationAt(
          from.project.projectDurationFrames,
          from.session.fps,
          fps,
        ),
        canvasWidth,
        canvasHeight,
        audioMix,
      },
      { audioAnalysis: "offline" },
    );

    let result: ExportActivity | null = null;
    try {
      const exported = await getHarness().exportVideo({
        filename: exportName,
        saveTarget,
        canvas: exportRenderer.canvas,
        settings,
        startSeconds,
        durationSeconds,
        frameCount,
        bpm,
        audio: { mix: audioMix, mediaItems: from.mediaItems },
        signal: abort.signal,
        renderFrameAt: (frameQ, frameSeconds) =>
          exportRenderer.renderFrameAt(frameQ, frameSeconds),
        setPlayheadQ: () => {},
        yieldBetweenFrames: () =>
          wait(isPlayingRef.current ? PLAYING_FRAME_YIELD_MS : 0),
        onProgress: (update) => {
          const now = performance.now();
          if (update.phase === "rendering" && renderStartedAt === null) {
            renderStartedAt = now;
          }
          setProgress(update);
          setSecondsLeft(
            estimateExportSecondsLeft(update, renderStartedAt, now),
          );
          updateExportState(update.phase, update.detail, update.progress);
        },
        onLog: logClient,
      });

      const done =
        exported.saveMethod === "download"
          ? `Exported ${exportName} (${exported.summary}) through the browser download flow.`
          : `Saved ${exportName} (${exported.summary}).`;
      setStatus(done);
      setMessage(done);
      setSavedTarget(saveTarget);
      result = { kind: "done", label: `Exported ${exportName}` };
      logClient("export:complete", {
        filename: exportName,
        bytes: exported.bytes,
        mimeType: exported.mimeType,
        muxedWith: exported.muxedWith,
        saveMethod: exported.saveMethod,
        encoding: exported.encoding,
      });
    } catch (error) {
      if (isAbort(error)) {
        setStatus("Export canceled.");
        setMessage("Export canceled.");
        logClient("export:canceled", {});
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Export failed: ${message}`);
        setMessage(`Export failed: ${message}`);
        result = { kind: "failed", label: `Export failed: ${message}` };
        logClient("export:error", { message });
      }
    } finally {
      abortRef.current = null;
      setPhase(result?.kind === "done" ? "done" : "editing");
      setProgress(null);
      setSecondsLeft(undefined);
      setIsExporting(false);
      setExportState({ phase: "idle", progress: null, detail: "" });
      exportRenderer.destroy();
      releaseMedia();
      // An export that ends out of sight says so until the dialog is shown.
      if (!openRef.current) {
        setUnseenResult(result);
      }
    }
  }

  function startExport() {
    if (isExporting) {
      return;
    }
    rememberedRef.current = { sessionName, options, session };
    setMessage("");
    setSavedTarget(null);
    setUnseenResult(null);
    void runExport(options, {
      takenAt: new Date(),
      project,
      session,
      defaultRange,
      mediaItems,
      audioPeaks,
      signature,
      beatUnit,
    });
  }

  function revealFile() {
    const harness = getHarness();
    if (!canRevealSavedFile(harness, savedTarget)) {
      return;
    }
    harness.revealSavedFile?.(savedTarget).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to reveal ${savedTarget.filename}: ${message}`);
      logClient("export:reveal:error", { message });
    });
  }

  // Exporting and done show the snapshot the export rendered; editing shows
  // the session as it is now.
  const shown = phase !== "editing" && snapshot ? snapshot : null;
  const shownProject = shown?.project ?? project;
  const shownRender = shown ? renderClipsOf(shown.project) : render;
  const shownMediaItems = shown?.mediaItems ?? mediaItems;
  const shownAudioMix = useMemo(
    () => audioMixOf(shownProject, shownMediaItems),
    [shownMediaItems, shownProject],
  );
  const exportDialog: ExportDialogModel = {
    open,
    phase,
    options,
    setOptions,
    session: shown?.session ?? session,
    defaultRange: shown?.defaultRange ?? defaultRange,
    progress,
    snapshotTakenAt: shown?.takenAt ?? null,
    message,
    canReveal: canRevealSavedFile(window.harness, savedTarget),
    mediaItems: shownMediaItems,
    clips: shownRender.clips,
    lanes: shownRender.lanes,
    effects: shownRender.effects,
    audioMix: shownAudioMix,
    audioPeaks: shown ? shown.audioPeaks : audioPeaks,
    bpm: shownProject.bpm,
    signature: shown?.signature ?? signature,
    beatUnit: shown?.beatUnit ?? beatUnit,
    projectDurationFrames: shownProject.projectDurationFrames,
    startExport,
    cancelExport,
    revealFile,
    close,
  };

  // Shown in the status bar while the dialog is hidden.
  const activityLabel = describeExportActivity(progress, secondsLeft);
  const activityProgress = progress?.progress ?? null;
  const exportActivity = useMemo<ExportActivity | null>(
    () =>
      open
        ? null
        : isExporting
          ? {
              kind: "running",
              label: activityLabel,
              progress: activityProgress,
            }
          : unseenResult,
    [activityLabel, activityProgress, isExporting, open, unseenResult],
  );

  return {
    openExportDialog,
    reopenExportDialog,
    dismissExportActivity,
    exportDialog,
    exportActivity,
  };
}
