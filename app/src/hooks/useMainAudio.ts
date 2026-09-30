import {
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PALETTE } from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState, SourceTrackDropTarget } from "../app/types.ts";
import { hasDraggedFileData, logClient } from "../app/util.ts";
import { getHarness } from "../harness";
import { withMainAudio } from "../main-audio";
import { getDroppedAudioFile, getMainAudioDragState } from "../main-audio-drop";
import { type MediaItem, toShareableMediaItem } from "../media";
import {
  describeMediaSync,
  formatMediaSyncLabel,
  type RemoteMediaProgressMap,
} from "../remote-media-sync.ts";
import { loadWaveformPeaks } from "../waveform-loader";
import type { WaveformPeaks } from "../waveform-peaks";

type ProjectUpdater = (current: ProjectState) => ProjectState;

export type MainAudioInputs = {
  mainAudioId: string | undefined;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  remoteMediaProgress: RemoteMediaProgressMap;
  projectMediaItems: MediaItem[];
  refuseReadOnlyEdit: () => boolean;
  commitProjectChange: (label: string, updater: ProjectUpdater) => void;
  commitProjectPatch: (label: string, patch: Partial<ProjectState>) => void;
  seedLocalMediaItems: (items: MediaItem[]) => void;
  cacheLocalMediaItems: (items: MediaItem[]) => Promise<void>;
  setStatus: (status: string) => void;
};

// The session's main audio: its media, the Audio lane's waveform and
// message, and adding, replacing and removing it.
export function useMainAudio({
  mainAudioId,
  mediaItemsById,
  remoteMediaProgress,
  projectMediaItems,
  refuseReadOnlyEdit,
  commitProjectChange,
  commitProjectPatch,
  seedLocalMediaItems,
  cacheLocalMediaItems,
  setStatus,
}: MainAudioInputs) {
  const [isMainAudioDropTarget, setIsMainAudioDropTarget] = useState(false);
  const mainAudio = mainAudioId ? mediaItemsById.get(mainAudioId) : undefined;
  // Only peaks decoded from the main audio are drawn; until they exist the
  // lane shows why there is no waveform instead of a placeholder.
  const mainAudioUrl =
    mainAudio?.availability === "ready" ? mainAudio.previewUrl : "";
  const mainWaveformKey =
    mainAudioId && mainAudioUrl ? `${mainAudioId}\n${mainAudioUrl}` : "";
  const [mainWaveform, setMainWaveform] = useState<{
    key: string;
    status: "ready" | "no-audio" | "error";
    peaks?: WaveformPeaks;
  } | null>(null);
  useEffect(() => {
    if (!mainAudioId || !mainAudioUrl) {
      return;
    }

    const key = `${mainAudioId}\n${mainAudioUrl}`;
    let canceled = false;
    loadWaveformPeaks(mainAudioId, mainAudioUrl).then(
      (result) => {
        if (!canceled) {
          setMainWaveform(
            result.status === "ready"
              ? { key, status: "ready", peaks: result.peaks }
              : { key, status: "no-audio" },
          );
        }
      },
      (error: unknown) => {
        logClient("waveform:decode:error", {
          mediaId: mainAudioId,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!canceled) {
          setMainWaveform({ key, status: "error" });
        }
      },
    );
    return () => {
      canceled = true;
    };
  }, [mainAudioId, mainAudioUrl]);
  const currentMainWaveform =
    mainWaveform && mainWaveform.key === mainWaveformKey ? mainWaveform : null;
  const mainAudioSync = mainAudio
    ? describeMediaSync(
        remoteMediaProgress.get(mainAudio.id),
        mainAudio.availability,
      )
    : null;
  const mainWaveformMessage = !mainAudio
    ? "No main audio track in this session"
    : mainAudioSync
      ? formatMediaSyncLabel(mainAudioSync, "main audio")
      : mainAudio.availability === "offline"
        ? "Main audio is offline"
        : mainAudio.availability === "hydrating"
          ? "Waiting for main audio…"
          : !currentMainWaveform
            ? "Analyzing main audio…"
            : currentMainWaveform.status === "no-audio"
              ? "No audio found in main audio file"
              : currentMainWaveform.status === "error"
                ? "Could not decode main audio"
                : null;

  // Imports an audio file through the media pipeline and makes it the
  // session's main audio. Shared by the Audio lane button and drag and drop.
  const replaceMainAudioFromFile = useCallback(
    async (file: File) => {
      if (refuseReadOnlyEdit()) {
        return;
      }

      const harness = getHarness();

      try {
        setStatus(`Analyzing ${file.name}...`);
        const [analyzed] = await harness.analyzeMedia(
          {
            kind: "files",
            files: [file],
          },
          PALETTE,
          projectMediaItems.length,
        );
        if (!analyzed) {
          throw new Error(`Could not read ${file.name}.`);
        }
        if (analyzed.kind !== "audio") {
          throw new Error(`${file.name} is not an audio file.`);
        }

        commitProjectChange(
          mainAudioId ? "Replace main audio" : "Add main audio",
          (current) =>
            patchProjectState(
              current,
              withMainAudio(current, toShareableMediaItem(analyzed)),
            ),
        );

        seedLocalMediaItems([analyzed]);
        void cacheLocalMediaItems([analyzed]);
        setStatus(`Set main audio to ${analyzed.name}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Main audio import failed: ${message}`);
      }
    },
    [
      cacheLocalMediaItems,
      commitProjectChange,
      mainAudioId,
      projectMediaItems.length,
      refuseReadOnlyEdit,
      seedLocalMediaItems,
      setStatus,
    ],
  );

  const mainAudioInputRef = useRef<HTMLInputElement>(null);

  function removeMainAudio() {
    commitProjectPatch("Remove main audio", { mainAudioId: undefined });
    setStatus("Removed main audio.");
  }

  return {
    mainAudio,
    currentMainWaveform,
    mainAudioSync,
    mainWaveformMessage,
    isMainAudioDropTarget,
    setIsMainAudioDropTarget,
    mainAudioInputRef,
    replaceMainAudioFromFile,
    removeMainAudio,
  };
}

// The waveform skeleton spans the known duration, else the visible lane.
export function getMainAudioSkeletonStyle({
  mainAudio,
  bpm,
  quarterPx,
  visibleTimelineStartPx,
  visibleTimelineWidthPx,
}: {
  mainAudio: MediaItem | undefined;
  bpm: number;
  quarterPx: number;
  visibleTimelineStartPx: number;
  visibleTimelineWidthPx: number;
}) {
  return mainAudio?.durationSeconds && mainAudio.durationSeconds > 0
    ? {
        left: 0,
        width: ((mainAudio.durationSeconds * bpm) / 60) * quarterPx,
      }
    : { left: visibleTimelineStartPx, width: visibleTimelineWidthPx };
}

export type MainAudioDropInputs = {
  sourceTrackDragTarget: SourceTrackDropTarget | null;
  clearSourceTrackDragState: () => void;
  setIsMainAudioDropTarget: (isDropTarget: boolean) => void;
  replaceMainAudioFromFile: (file: File) => Promise<void>;
  setStatus: (status: string) => void;
};

// Dropping an audio file on the Audio lane. The handlers cancel a source
// track drop, whose state useSourceTrackDrop declares after useMainAudio, so
// useMediaImport calls this hook after it.
export function useMainAudioDrop({
  sourceTrackDragTarget,
  clearSourceTrackDragState,
  setIsMainAudioDropTarget,
  replaceMainAudioFromFile,
  setStatus,
}: MainAudioDropInputs) {
  const handleMainAudioDragEvent = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!hasDraggedFileData(event.dataTransfer)) {
        return;
      }

      // The Audio lane never hosts source tracks, so a drag over it cancels any
      // pending source track drop.
      if (sourceTrackDragTarget) {
        clearSourceTrackDragState();
      }

      event.preventDefault();
      event.stopPropagation();
      const accepted = getMainAudioDragState(event.dataTransfer) === "accept";
      event.dataTransfer.dropEffect = accepted ? "copy" : "none";
      setIsMainAudioDropTarget(accepted);
    },
    [
      clearSourceTrackDragState,
      setIsMainAudioDropTarget,
      sourceTrackDragTarget,
    ],
  );

  const handleMainAudioDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }

      setIsMainAudioDropTarget(false);
    },
    [setIsMainAudioDropTarget],
  );

  const handleMainAudioDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!hasDraggedFileData(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearSourceTrackDragState();
      const file = getDroppedAudioFile(event.dataTransfer.files);
      if (!file) {
        setStatus("Only audio files can be dropped on the Audio lane.");
        return;
      }

      void replaceMainAudioFromFile(file);
    },
    [clearSourceTrackDragState, replaceMainAudioFromFile, setStatus],
  );

  return {
    handleMainAudioDragEvent,
    handleMainAudioDragLeave,
    handleMainAudioDrop,
  };
}
