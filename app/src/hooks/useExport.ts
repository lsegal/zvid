import { type Dispatch, type SetStateAction, useState } from "react";
import { quartersToSeconds } from "../app/timeline-math.ts";
import type { ExportState, ProjectState } from "../app/types.ts";
import { logClient, pluralize, sanitizeFilenameSegment } from "../app/util.ts";
import {
  type CompositionPlayerHandle,
  CompositionRenderer,
} from "../CompositionPlayer";
import { getHarness, type SaveTarget } from "../harness";
import type { MediaItem } from "../media";

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
  clips: ProjectState["clips"];
  timelineClips: ProjectState["clips"];
  mediaItems: MediaItem[];
  lanes: ProjectState["lanes"];
  effects: ProjectState["effects"];
  mainAudio: MediaItem | undefined;
  bpm: number;
  fps: number;
  projectDurationFrames: number | undefined;
  canvasWidth: number;
  canvasHeight: number;
  sessionName: string | null;
  playheadQRef: { current: number };
  compositionPlayerRef: { current: CompositionPlayerHandle | null };
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Renders the arrangement to an MP4 and saves it.
export function useExport({
  isExporting,
  setIsExporting,
  setExportState,
  updateExportState,
  clips,
  timelineClips,
  mediaItems,
  lanes,
  effects,
  mainAudio,
  bpm,
  fps,
  projectDurationFrames,
  canvasWidth,
  canvasHeight,
  sessionName,
  playheadQRef,
  compositionPlayerRef,
  setIsPlaying,
  setStatus,
}: ExportInputs) {
  async function handleExport() {
    if (isExporting) {
      return;
    }

    if (!clips.length) {
      setStatus("Open a session or import media before exporting.");
      return;
    }

    const durationSeconds = Math.max(
      0.01,
      mainAudio?.durationSeconds ?? 0,
      ...clips.map(
        (clip) => quartersToSeconds(clip.startQ, bpm) + clip.durationSeconds,
      ),
    );
    const outputFrameRate = Math.max(1, fps);
    const outputFrameDuration = 1 / outputFrameRate;
    const outputFrameCount = Math.max(
      1,
      Math.ceil(durationSeconds * outputFrameRate),
    );
    const exportName = `${sanitizeFilenameSegment(sessionName ?? "zvid-session")}.mp4`;

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
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Export canceled before rendering.");
        return;
      }

      setStatus(`Failed to prepare export destination: ${message}`);
      return;
    }

    setIsPlaying(false);
    setIsExporting(true);
    updateExportState(
      "preparing",
      `Preparing export (${pluralize(outputFrameCount, "frame")})...`,
      null,
    );
    logClient("export:start", {
      durationSeconds,
      frameRate: outputFrameRate,
      frames: outputFrameCount,
      canvasWidth,
      canvasHeight,
      mainAudio: mainAudio?.name,
    });
    logClient("export:phase", { phase: "preparing", frames: outputFrameCount });

    const exportRenderer = new CompositionRenderer(
      {
        mediaItems,
        clips: timelineClips,
        lanes,
        effects,
        bpm,
        fps,
        projectDurationFrames,
        canvasWidth,
        canvasHeight,
        mainAudio,
      },
      { audioAnalysis: "offline" },
    );

    try {
      const result = await getHarness().exportVideo({
        filename: exportName,
        saveTarget,
        canvas: exportRenderer.canvas,
        canvasWidth,
        canvasHeight,
        durationSeconds,
        frameRate: outputFrameRate,
        frameCount: outputFrameCount,
        frameDuration: outputFrameDuration,
        bpm,
        mainAudio,
        renderFrameAt: (frameQ, frameSeconds) =>
          exportRenderer.renderFrameAt(frameQ, frameSeconds),
        setPlayheadQ: () => {},
        onProgress: (update) => {
          updateExportState(update.phase, update.detail, update.progress);
        },
        onLog: logClient,
      });

      setStatus(
        result.saveMethod === "download"
          ? `Exported ${exportName} through the browser download flow.`
          : `Saved ${exportName}.`,
      );
      setExportState({ phase: "idle", progress: null, detail: "" });
      logClient("export:complete", {
        filename: exportName,
        bytes: result.bytes,
        mimeType: result.mimeType,
        muxedWith: result.muxedWith,
        saveMethod: result.saveMethod,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExportState({ phase: "idle", progress: null, detail: "" });
      setStatus(`Export failed: ${message}`);
      logClient("export:error", { message });
    } finally {
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

  return { handleExport };
}
