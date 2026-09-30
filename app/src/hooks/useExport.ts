import { type Dispatch, type SetStateAction, useRef, useState } from "react";
import { quartersToSeconds } from "../app/timeline-math.ts";
import type { ExportState, ProjectState } from "../app/types.ts";
import { logClient, pluralize } from "../app/util.ts";
import {
  type CompositionPlayerHandle,
  CompositionRenderer,
} from "../CompositionPlayer";
import {
  createExportOptions,
  defaultExportFileName,
  defaultExportRange,
  type ExportOptions,
  type ExportRange,
  exportSettings,
  exportTiming,
  normalizeExportFileName,
  reopenExportOptions,
} from "../export-options.ts";
import {
  canRevealSavedFile,
  getHarness,
  type SaveTarget,
} from "../harness";
import type { ExportProgress } from "../harness/contracts";
import type { MediaItem } from "../media";
import {
  type SessionSettings,
  sessionSettingsFromProject,
} from "../session-settings";
import type { MeterSignature } from "../timeline-format.ts";
import type { WaveformPeaks } from "../waveform-peaks";

export type ExportStateInputs = {
  setStatus: Dispatch<SetStateAction<string>>;
};

// Whether an export is running, its progress, and the Export button label
// and status text that show it. App calls this early, since much of App
// reads `isExporting`.
export function useExportState({ setStatus }: ExportStateInputs) {
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
    setExportState({
      phase,
      detail,
      progress,
    });
    setStatus(detail);
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

  // Export progress stays visible for the whole export.
  const exportStatusText =
    isExporting && exportState.detail ? exportState.detail : "";

  return {
    isExporting,
    setIsExporting,
    setExportState,
    updateExportState,
    exportButtonLabel,
    exportStatusText,
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
  mainAudio: MediaItem | undefined;
  mainAudioPeaks: WaveformPeaks | undefined;
  signature: MeterSignature;
  beatUnit: number;
  playheadQRef: { current: number };
  compositionPlayerRef: { current: CompositionPlayerHandle | null };
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export type ExportDialogPhase = "editing" | "exporting" | "done";

// What the Export dialog shows and does. See ExportDialog.
export type ExportDialogModel = {
  open: boolean;
  phase: ExportDialogPhase;
  options: ExportOptions;
  setOptions: Dispatch<SetStateAction<ExportOptions>>;
  session: SessionSettings;
  defaultRange: ExportRange;
  progress: ExportProgress | null;
  // What the last export did, shown once it finishes or fails.
  message: string;
  // Whether the done state offers Reveal file for the saved export.
  canReveal: boolean;
  mediaItems: MediaItem[];
  clips: ProjectState["clips"];
  lanes: ProjectState["lanes"];
  effects: ProjectState["effects"];
  mainAudio: MediaItem | undefined;
  mainAudioPeaks: WaveformPeaks | undefined;
  bpm: number;
  signature: MeterSignature;
  beatUnit: number;
  startExport(): void;
  cancelExport(): void;
  revealFile(): void;
  close(): void;
};

type Remembered = {
  sessionName: string | null;
  options: ExportOptions;
  session: SessionSettings;
};

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

// Export opens the Export dialog, where the In→Out range and the settings
// are chosen; the dialog's Export renders that range to an MP4 and saves it.
export function useExport({
  isExporting,
  setIsExporting,
  setExportState,
  updateExportState,
  project,
  mediaItems,
  mainAudio,
  mainAudioPeaks,
  signature,
  beatUnit,
  playheadQRef,
  compositionPlayerRef,
  setIsPlaying,
  setStatus,
}: ExportInputs) {
  const { clips, lanes, effects, bpm, sessionName } = project;
  const session = sessionSettingsFromProject(project);
  const defaultRange = defaultExportRange({
    clips,
    bpm,
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
  // Where the last successful export was saved, for Reveal file.
  const [savedTarget, setSavedTarget] = useState<SaveTarget | null>(null);
  // The options last used, kept while the app is open (not saved) so
  // reopening Export picks up where it left off.
  const rememberedRef = useRef<Remembered | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function openExportDialog() {
    if (isExporting) {
      return;
    }
    if (!clips.length) {
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
    setOpen(true);
  }

  function close() {
    if (abortRef.current) {
      return;
    }
    rememberedRef.current = { sessionName, options, session };
    setOpen(false);
  }

  function cancelExport() {
    abortRef.current?.abort();
  }

  async function runExport(exportOptions: ExportOptions) {
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
      mainAudio: mainAudio?.name,
    });
    logClient("export:phase", { phase: "preparing", frames: frameCount });

    const exportRenderer = new CompositionRenderer(
      {
        mediaItems,
        clips,
        lanes,
        effects,
        bpm,
        fps,
        canvasWidth,
        canvasHeight,
        mainAudio,
      },
      { audioAnalysis: "offline" },
    );

    let finished = false;
    try {
      const result = await getHarness().exportVideo({
        filename: exportName,
        saveTarget,
        canvas: exportRenderer.canvas,
        settings,
        startSeconds,
        durationSeconds,
        frameCount,
        bpm,
        mainAudio,
        signal: abort.signal,
        renderFrameAt: (frameQ, frameSeconds) =>
          exportRenderer.renderFrameAt(frameQ, frameSeconds),
        setPlayheadQ: () => {},
        onProgress: (update) => {
          setProgress(update);
          updateExportState(update.phase, update.detail, update.progress);
        },
        onLog: logClient,
      });

      const done =
        result.saveMethod === "download"
          ? `Exported ${exportName} (${result.summary}) through the browser download flow.`
          : `Saved ${exportName} (${result.summary}).`;
      setStatus(done);
      setMessage(done);
      setSavedTarget(saveTarget);
      finished = true;
      logClient("export:complete", {
        filename: exportName,
        bytes: result.bytes,
        mimeType: result.mimeType,
        muxedWith: result.muxedWith,
        saveMethod: result.saveMethod,
        encoding: result.encoding,
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
        logClient("export:error", { message });
      }
    } finally {
      abortRef.current = null;
      setPhase(finished ? "done" : "editing");
      setProgress(null);
      setIsExporting(false);
      setExportState({ phase: "idle", progress: null, detail: "" });
      exportRenderer.destroy();
      const previewPlayheadQ = playheadQRef.current;
      try {
        await compositionPlayerRef.current?.restorePreviewSurface(
          previewPlayheadQ,
          quartersToSeconds(previewPlayheadQ, bpm),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logClient("export:restorePreviewSurface:error", { message });
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
    void runExport(options);
  }

  function revealFile() {
    const harness = getHarness();
    if (!savedTarget || !canRevealSavedFile(harness, savedTarget)) {
      return;
    }
    harness.revealSavedFile?.(savedTarget).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed to reveal ${savedTarget.filename}: ${message}`);
      logClient("export:reveal:error", { message });
    });
  }

  const exportDialog: ExportDialogModel = {
    open,
    phase,
    options,
    setOptions,
    session,
    defaultRange,
    progress,
    message,
    canReveal: canRevealSavedFile(window.harness, savedTarget),
    mediaItems,
    clips,
    lanes,
    effects,
    mainAudio,
    mainAudioPeaks,
    bpm,
    signature,
    beatUnit,
    startExport,
    cancelExport,
    revealFile,
    close,
  };

  return { openExportDialog, exportDialog };
}
