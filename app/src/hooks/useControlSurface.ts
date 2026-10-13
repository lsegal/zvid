import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { hasUnsavedSessionChanges } from "../app/new-session.ts";
import type { SourceTrackDropTarget } from "../app/types.ts";
import {
  type ControlSurface,
  createControlSurface,
} from "../control/surface.ts";
import type {
  ControlExportOutcome,
  ControlExportRequest,
  ControlHost,
} from "../control/types.ts";
import type { ExportRange } from "../export-options.ts";
import { type SaveTarget, supportsHarnessCapability } from "../harness";
import type { ExportOutcome } from "./useExport.ts";
import type { MediaImportResult } from "./useMediaLibrary.ts";
import type { usePlayback } from "./usePlayback.ts";
import type { ProjectStore } from "./useProjectStore.ts";
import type { Timeline } from "./useTimeline.ts";
import type { TimelineSelectionState } from "./useTimelineSelection.ts";

declare global {
  interface Window {
    // zvid's control surface, for agents driving the app; see
    // control/SKILL.md.
    zvid?: ControlSurface;
  }
}

export type ControlSurfaceInputs = {
  hooks: {
    store: ProjectStore;
    selection: TimelineSelectionState;
    timeline: Timeline;
    playback: ReturnType<typeof usePlayback>;
    historyCommands: { handleUndo: () => void; handleRedo: () => void };
  };
  transport: { isPlaying: boolean; setIsPlaying: (playing: boolean) => void };
  importMedia: (
    files: File[],
    target: SourceTrackDropTarget,
  ) => Promise<MediaImportResult>;
  exportTo: (target: SaveTarget, range?: ExportRange) => Promise<ExportOutcome>;
  newSession: {
    canStartNewSession: boolean;
    discardAndStartNewSession: () => void;
  };
};

// How long an import waits for its media to show up in the project.
const IMPORT_SETTLE_MS = 5000;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

// Installs the control surface as `window.zvid` while the app is mounted.
// Commands read the app as of its latest render, and every edit renders
// before the command goes on, so a command sees the ones before it.
export function useControlSurface(inputs: ControlSurfaceInputs) {
  const latestRef = useRef(inputs);
  latestRef.current = inputs;

  useEffect(() => {
    const latest = () => latestRef.current;
    const project = () => latest().hooks.store.projectHistory.present;
    // The last export kept in memory, released when the next one replaces it.
    let exportUrl: string | undefined;

    async function exportVideo(
      request: ControlExportRequest,
    ): Promise<ControlExportOutcome> {
      let blob: Blob | undefined;
      const target: SaveTarget =
        request.destination === "memory"
          ? {
              kind: "blob",
              filename: request.fileName,
              receive: (file) => {
                blob = file;
              },
            }
          : request.destination === "path" && request.path
            ? {
                kind: "native-path",
                filename: request.fileName,
                path: request.path,
              }
            : { kind: "download", filename: request.fileName };
      const outcome = await latest().exportTo(target, request.range);
      if (outcome.kind !== "done") {
        return outcome;
      }
      const { saveMethod: _saveMethod, ...done } = outcome;
      if (!blob) {
        return done;
      }
      if (exportUrl) {
        URL.revokeObjectURL(exportUrl);
      }
      exportUrl = URL.createObjectURL(blob);
      return { ...done, url: exportUrl };
    }

    const host: ControlHost = {
      getProject: project,
      commit: (label, updater) =>
        flushSync(() =>
          latest().hooks.store.commitProjectChange(label, updater),
        ),
      isReadOnly: () => latest().hooks.store.isWorkspaceReadOnlyRef.current,
      canUndo: () => latest().hooks.store.undoLabel,
      canRedo: () => latest().hooks.store.redoLabel,
      undo: () => flushSync(() => latest().hooks.historyCommands.handleUndo()),
      redo: () => flushSync(() => latest().hooks.historyCommands.handleRedo()),
      newSession: () =>
        flushSync(() => latest().newSession.discardAndStartNewSession()),
      hasUnsavedChanges: () =>
        hasUnsavedSessionChanges(
          latest().hooks.store.projectHistory,
          latest().hooks.store.hasUnsavedChanges,
        ),
      newSessionBlocker: () =>
        latest().newSession.canStartNewSession
          ? undefined
          : "A new session can't start while collaborating.",
      getPlayheadQ: () => latest().hooks.store.playheadQRef.current,
      setPlayheadQ: (quarters) =>
        flushSync(() => latest().hooks.playback.jumpPlayheadTo(quarters)),
      isPlaying: () => latest().transport.isPlaying,
      play: () => {
        if (!latest().hooks.playback.playableClipCount) {
          return false;
        }
        flushSync(() => latest().hooks.playback.startPlayback());
        return latest().transport.isPlaying;
      },
      pause: () => flushSync(() => latest().transport.setIsPlaying(false)),
      getLoop: () => latest().hooks.timeline.loopRegion,
      setLoop: (loop) =>
        flushSync(() => latest().hooks.timeline.setLoopRegion(loop)),
      getSelectedClipId: () => latest().hooks.selection.selectedClip?.id,
      selectClip: (clipId) =>
        flushSync(() => {
          latest().hooks.selection.setPendingSelection(null);
          latest().hooks.selection.setSelectedClipId(clipId);
        }),
      async importMedia(files, target) {
        const result = await latest().importMedia(files, target);
        // The import commits as it finishes; wait for that render.
        const ids = result.imported.map((item) => item.id);
        const deadline = Date.now() + IMPORT_SETTLE_MS;
        while (
          !ids.every((id) =>
            project().mediaItems.some((item) => item.id === id),
          )
        ) {
          if (Date.now() > deadline) {
            return {
              imported: [],
              error: "The imported media never reached the session.",
            };
          }
          await wait(10);
        }
        return result;
      },
      exportVideo,
      canExportToPath: () => supportsHarnessCapability("native-dialogs"),
      fetch: (url) => fetch(url),
    };

    const surface = createControlSurface(host);
    window.zvid = surface;
    return () => {
      if (window.zvid === surface) {
        delete window.zvid;
      }
      if (exportUrl) {
        URL.revokeObjectURL(exportUrl);
      }
    };
  }, []);
}
