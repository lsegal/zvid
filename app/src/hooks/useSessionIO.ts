import type { Dispatch, SetStateAction } from "react";
import {
  AlsImportError,
  formatAlsImportSummary,
  isAlsFilename,
} from "../als-import";
import { DEFAULT_LANES, PALETTE } from "../app/constants.ts";
import {
  buildStandaloneProject,
  hydrateProjectMedia,
  patchProjectState,
  sessionToProject,
} from "../app/session-project.ts";
import { secondsToQuarters } from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  LocalMediaOverride,
  ProjectState,
  SessionMediaCheck,
  TimelineSelection,
} from "../app/types.ts";
import { basename, logClient, pluralize } from "../app/util.ts";
import { isArrangementEmptyStateDismissedOnOpen } from "../arrangement-empty-state.ts";
import type { ImportNoticeContent } from "../components/ImportNotice";
import { addDefaultGain } from "../default-gain.ts";
import { getDefaultLaneId } from "../fx-chain";
import { ensureGlobalOrder, ensureLayerLayouts } from "../fx-stack";
import { getHarness, type SaveTarget, type SessionSelection } from "../harness";
import {
  buildFallbackMediaItem,
  type MediaItem,
  toShareableMediaItem,
} from "../media";
import { restoreMediaRanges } from "../media-range.ts";
import type { ProjectHistoryState } from "../project-history";
import { resolveSampleMediaRefs } from "../sample/sample-manifest.ts";
import { SAMPLE_MANIFESTS } from "../sample/samples.ts";
import {
  formatClipsWithoutFile,
  normalizeLvpSession,
  type SessionOpenResponse,
} from "../session";
import {
  chooseSessionSaveTarget,
  projectToLvpSession,
  readSessionMediaRanges,
  SESSION_FILE_EXTENSION,
} from "../session-save.ts";
import type { WorkspaceSessionSource } from "../workspace-session.ts";

export type SessionIOInputs = {
  projectHistory: ProjectHistoryState<ProjectState>;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  commitViewChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  sessionName: string | null;
  mediaItems: MediaItem[];
  projectMediaItems: MediaItem[];
  playheadQRef: { current: number };
  setPlayheadQ: (nextQ: number) => void;
  selectedClipId: string | undefined;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedLaneId: Dispatch<SetStateAction<string | undefined>>;
  sessionSource: WorkspaceSessionSource;
  setSessionSource: Dispatch<SetStateAction<WorkspaceSessionSource>>;
  setImportNotice: Dispatch<SetStateAction<ImportNoticeContent | null>>;
  setDragPreviewClips: Dispatch<SetStateAction<ArrangementClip[] | null>>;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setArrangementEmptyStateDismissed: Dispatch<SetStateAction<boolean>>;
  seedLocalMediaItems: (items: MediaItem[]) => void;
  cacheLocalMediaItems: (items: MediaItem[]) => Promise<void>;
  localMediaOverridesRef: { current: Record<string, LocalMediaOverride> };
  sessionMediaCheckRef: { current: SessionMediaCheck | null };
  claimWorkspaceSession: () => void;
  reportSessionMediaCheck: () => void;
  refuseReadOnlyEdit: () => boolean;
  setHasUnsavedChanges: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

// Opens, imports and saves sessions and media through the harness.
export function useSessionIO({
  projectHistory,
  commitProjectChange,
  commitViewChange,
  sessionName,
  mediaItems,
  projectMediaItems,
  playheadQRef,
  setPlayheadQ,
  selectedClipId,
  setSelectedClipId,
  setSelectedLaneId,
  sessionSource,
  setSessionSource,
  setImportNotice,
  setDragPreviewClips,
  setPendingSelection,
  setArrangementEmptyStateDismissed,
  seedLocalMediaItems,
  cacheLocalMediaItems,
  localMediaOverridesRef,
  sessionMediaCheckRef,
  claimWorkspaceSession,
  reportSessionMediaCheck,
  refuseReadOnlyEdit,
  setHasUnsavedChanges,
  setStatus,
}: SessionIOInputs) {
  async function applyOpenedSessionPayload(
    opened: SessionOpenResponse,
    // A sample opens as an editable copy: saving it asks where to save.
    selection: SessionSelection | { kind: "sample" },
  ) {
    const payload = {
      ...opened,
      mediaRefs: resolveSampleMediaRefs(opened.mediaRefs, SAMPLE_MANIFESTS),
    };
    claimWorkspaceSession();
    setSessionSource(
      payload.alsImport || selection.kind === "sample"
        ? { kind: "import", name: payload.sessionName }
        : selection.kind === "path"
          ? { kind: "path", name: payload.sessionName, path: selection.path }
          : { kind: selection.kind, name: payload.sessionName },
    );
    const existingRefs = payload.mediaRefs.filter((ref) => ref.exists);
    const missingRefs = payload.mediaRefs.filter((ref) => !ref.exists);
    const { session, clipsWithoutFile } = normalizeLvpSession(payload.session);
    const placeholderMedia = restoreMediaRanges(
      payload.mediaRefs.map((ref, index) =>
        buildFallbackMediaItem(
          ref,
          PALETTE[index % PALETTE.length] ?? PALETTE[0],
        ),
      ),
      readSessionMediaRanges(session),
    );
    logClient("openSession:mediaRefs", {
      total: payload.mediaRefs.length,
      existing: existingRefs.length,
      missing: missingRefs.length,
    });

    if (clipsWithoutFile.length) {
      logClient("openSession:clipsWithoutFile", { clips: clipsWithoutFile });
    }

    const project = sessionToProject(session, placeholderMedia);
    // A stale selection from the previous session would dismiss the empty
    // arrangement's call to action as soon as it appears.
    setSelectedClipId(undefined);
    setArrangementEmptyStateDismissed(
      isArrangementEmptyStateDismissedOnOpen(project.arrangementClips.length),
    );
    logClient("openSession:project", {
      clips: project.arrangementClips.length,
      lanes: project.lanes.length,
      sourceTracks: project.sourceTracks.length,
    });

    commitProjectChange("Open session", (current) =>
      patchProjectState(current, {
        sessionName: payload.sessionName,
        mediaItems: placeholderMedia.map((item) => toShareableMediaItem(item)),
        bpm: project.bpm,
        fps: project.fps,
        canvasWidth: project.canvasWidth,
        canvasHeight: project.canvasHeight,
        encoding: project.encoding,
        timelineMode: project.displaySeconds ? "timecode" : "musical",
        snapEnabled: project.snapToBeat,
        zoom: project.zoom,
        lanes: project.lanes.length ? project.lanes : DEFAULT_LANES,
        sourceTracks: project.sourceTracks,
        sourceSpans: project.sourceSpans,
        clips: project.arrangementClips,
        effects: project.effects,
        projectDurationFrames: project.projectDurationFrames,
        sourceTracksLocked: project.sourceTracksLocked,
      }),
    );
    // A session opened from a file is saved as it stands. A sample or an
    // imported Live set has never been saved as a session.
    setHasUnsavedChanges(
      selection.kind === "sample" || Boolean(payload.alsImport),
    );
    setDragPreviewClips(null);
    setPendingSelection(null);
    const clipsWithoutFileLines = clipsWithoutFile.length
      ? [formatClipsWithoutFile(clipsWithoutFile)]
      : [];
    setImportNotice(
      payload.alsImport
        ? {
            tone:
              payload.alsImport.noLayersVideo || clipsWithoutFile.length
                ? "warning"
                : "summary",
            title: `Imported ${payload.sessionName}`,
            lines: [
              ...formatAlsImportSummary(payload.alsImport, payload.sessionName),
              ...clipsWithoutFileLines,
            ],
          }
        : clipsWithoutFile.length
          ? {
              tone: "warning",
              title: `Opened ${payload.sessionName}`,
              lines: clipsWithoutFileLines,
            }
          : null,
    );

    const preferredClip = project.arrangementClips.find(
      (clip) => clip.id === project.selectedClipId,
    );
    setSelectedClipId(preferredClip?.id);
    setSelectedLaneId(
      preferredClip?.laneId ??
        getDefaultLaneId(
          project.lanes.length ? project.lanes : DEFAULT_LANES,
          project.effects,
        ),
    );
    setPlayheadQ(
      secondsToQuarters(project.playPositionFrames / project.fps, project.bpm),
    );
    seedLocalMediaItems(
      existingRefs.map((ref, index) => ({
        ...buildFallbackMediaItem(
          ref,
          PALETTE[index % PALETTE.length] ?? PALETTE[0],
        ),
        previewUrl: ref.url,
        availability: "ready",
      })),
    );

    // Offline refs may still be restored from the media cache by the
    // hydration effect; report the outcome once every ref has settled.
    const pendingOfflineIds = missingRefs
      .map((ref) => ref.id)
      .filter((id) => !localMediaOverridesRef.current[id]?.previewUrl);
    const mediaCheck: SessionMediaCheck = {
      sessionName: payload.sessionName,
      pendingIds: new Set(pendingOfflineIds),
      restored: 0,
      offline: 0,
      analyzingFromDisk: existingRefs.length > 0,
      hydratedFromDisk: existingRefs.length > 0,
      overlapNote: project.overlapNote,
    };
    sessionMediaCheckRef.current = mediaCheck;

    if (existingRefs.length) {
      setStatus(
        `Loaded ${payload.sessionName}. Hydrating ${pluralize(existingRefs.length, "media file")} in the background. ${project.overlapNote}`.trim(),
      );
    } else if (pendingOfflineIds.length) {
      setStatus(
        `Loaded ${payload.sessionName}. Checking the media cache for ${pluralize(pendingOfflineIds.length, "offline media file")}... ${project.overlapNote}`.trim(),
      );
    } else {
      reportSessionMediaCheck();
    }

    if (existingRefs.length) {
      void (async () => {
        try {
          const analyzedMedia = await getHarness().analyzeMedia(
            {
              kind: "refs",
              refs: existingRefs,
            },
            PALETTE,
            0,
          );
          logClient("openSession:analyzedMedia", {
            analyzed: analyzedMedia.length,
            degraded: 0,
          });
          seedLocalMediaItems(analyzedMedia);
          void cacheLocalMediaItems(analyzedMedia);
          commitViewChange("Hydrate session media", (current) =>
            hydrateProjectMedia(
              current,
              analyzedMedia.map((item) => toShareableMediaItem(item)),
            ),
          );
          mediaCheck.analyzingFromDisk = false;
          reportSessionMediaCheck();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (sessionMediaCheckRef.current === mediaCheck) {
            sessionMediaCheckRef.current = null;
          }
          setStatus(`Session media hydration failed: ${message}`);
        }
      })();
    }
  }

  async function handleImport() {
    if (refuseReadOnlyEdit()) {
      return;
    }

    const harness = getHarness();
    const selection = await harness.pickMedia();
    if (!selection) {
      return;
    }

    try {
      const itemCount =
        selection.kind === "files"
          ? selection.files.length
          : selection.refs.length;
      setStatus(`Analyzing ${pluralize(itemCount, "imported media file")}...`);
      const nextPaletteIndex = mediaItems.length;
      const analyzed = await harness.analyzeMedia(
        selection,
        PALETTE,
        nextPaletteIndex,
      );
      const sharedAnalyzed = analyzed.map((item) => toShareableMediaItem(item));

      const nextMedia = [...projectMediaItems, ...sharedAnalyzed];
      if (!sessionName) {
        const standalone = buildStandaloneProject(nextMedia);
        commitProjectChange("Import media", (current) =>
          patchProjectState(current, {
            mediaItems: nextMedia,
            lanes: standalone.lanes,
            // Each clip of media with sound gets its Gain.
            effects: addDefaultGain(
              ensureGlobalOrder(
                ensureLayerLayouts(
                  current.effects,
                  standalone.lanes.map((lane) => lane.id),
                ),
              ),
              {
                clips: standalone.arrangementClips,
                sourceSpans: standalone.sourceSpans,
              },
              nextMedia,
            ),
            sourceTracks: standalone.sourceTracks,
            sourceSpans: standalone.sourceSpans,
            clips: standalone.arrangementClips,
            canvasWidth: standalone.canvasWidth,
            canvasHeight: standalone.canvasHeight,
            ...(standalone.fps && { fps: standalone.fps }),
            projectDurationFrames: undefined,
            sourceTracksLocked: false,
          }),
        );
        setDragPreviewClips(null);
        setSelectedClipId(standalone.arrangementClips[0]?.id);
        setPendingSelection(null);
      } else {
        commitProjectChange("Import media", (current) =>
          patchProjectState(current, {
            mediaItems: nextMedia,
          }),
        );
      }

      seedLocalMediaItems(analyzed);
      void cacheLocalMediaItems(analyzed);
      setStatus(`Imported ${pluralize(analyzed.length, "media file")}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Media import failed: ${message}`);
    }
  }

  // A failed Live set import is reported in the import notice, since the
  // status line alone is easy to miss.
  function reportOpenFailure(
    prefix: string,
    selectionName: string | undefined,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : String(error);
    // The status line only has room for the message, so log the stack to
    // keep the failing call site visible.
    logClient("openSession:error", {
      prefix,
      selectionName,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    setStatus(`${prefix}: ${message}`);
    if (
      error instanceof AlsImportError ||
      (selectionName && isAlsFilename(selectionName))
    ) {
      setImportNotice({
        tone: "error",
        title: `Could not open ${selectionName ?? "the Live set"}`,
        lines: [message],
      });
    }
  }

  async function handleOpenSession() {
    if (refuseReadOnlyEdit()) {
      return;
    }

    const harness = getHarness();
    let selectionName: string | undefined;
    try {
      const selection = await harness.pickSession();
      if (!selection) {
        return;
      }
      selectionName =
        selection.kind === "file"
          ? selection.file.name
          : selection.kind === "workspace"
            ? selection.sessionFile.name
            : selection.name;
      setStatus(`Opening ${selectionName}...`);
      const payload = await harness.openSession(selection);
      await applyOpenedSessionPayload(payload, selection);
    } catch (error) {
      reportOpenFailure("Open failed", selectionName, error);
    }
  }

  async function handleOpenWorkspace() {
    if (refuseReadOnlyEdit()) {
      return;
    }

    const harness = getHarness();
    if (!harness.pickWorkspace) {
      setStatus(
        "Opening a workspace is not supported in this version of zvid.",
      );
      return;
    }

    let selectionName: string | undefined;
    try {
      const selection = await harness.pickWorkspace();
      if (!selection) {
        return;
      }

      selectionName =
        selection.kind === "workspace"
          ? selection.sessionFile.name
          : selection.kind === "file"
            ? selection.file.name
            : selection.name;
      setStatus(`Opening workspace ${selectionName}...`);
      const payload = await harness.openSession(selection);
      await applyOpenedSessionPayload(payload, selection);
    } catch (error) {
      reportOpenFailure("Open workspace failed", selectionName, error);
    }
  }

  // Resolves to whether the session was saved.
  async function handleSaveSession() {
    const harness = getHarness();
    const session = projectToLvpSession(projectHistory.present, {
      playheadQ: playheadQRef.current,
      selectedClipId,
    });
    const blob = new Blob([`${JSON.stringify(session, null, 2)}\n`], {
      type: "application/json",
    });
    const choice = chooseSessionSaveTarget(sessionSource, sessionName);

    let saveTarget: SaveTarget;
    if (choice.kind === "path" && harness.capabilities["native-blob-write"]) {
      saveTarget = {
        kind: "native-path",
        filename: basename(choice.path),
        path: choice.path,
      };
    } else {
      const filename =
        choice.kind === "path" ? basename(choice.path) : choice.filename;
      try {
        const nextSaveTarget = await harness.prepareSave(filename, {
          mimeType: "application/json",
          extensions: [SESSION_FILE_EXTENSION],
          description: "ZVID session",
        });
        if (!nextSaveTarget) {
          setStatus("Save canceled.");
          return false;
        }
        saveTarget = nextSaveTarget;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatus("Save canceled.");
          return false;
        }
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to prepare save destination: ${message}`);
        return false;
      }
    }

    try {
      await harness.saveBlob(blob, saveTarget);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Save failed: ${message}`);
      return false;
    }
    setHasUnsavedChanges(false);

    // A session saved to a new path keeps saving there.
    if (saveTarget.kind === "native-path" && sessionSource.kind !== "path") {
      setSessionSource({
        kind: "path",
        name: basename(saveTarget.path),
        path: saveTarget.path,
      });
    }
    const savedName =
      saveTarget.kind === "native-path" ? saveTarget.path : saveTarget.filename;
    setStatus(`Saved ${savedName}.`);
    return true;
  }

  // Opens a bundled sample whose media is already in the media cache.
  async function openSamplePayload(payload: SessionOpenResponse) {
    await applyOpenedSessionPayload(payload, { kind: "sample" });
  }

  return {
    openSamplePayload,
    handleImport,
    handleOpenSession,
    handleOpenWorkspace,
    handleSaveSession,
  };
}
