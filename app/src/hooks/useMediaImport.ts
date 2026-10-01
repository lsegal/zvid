import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ArrangementClip, ProjectState } from "../app/types.ts";
import type { AppMedia } from "./useAppMedia.ts";
import type { CollaborationStateResult } from "./useCollaboration.ts";
import { type useMainAudio, useMainAudioDrop } from "./useMainAudio.ts";
import { useMediaLibraryCommands } from "./useMediaLibrary.ts";
import { useMediaStatus } from "./useMediaStatus.ts";
import type { ProjectStore } from "./useProjectStore.ts";
import { useSourceTrackDrop } from "./useSourceTrackDrop.ts";

export type MediaImportInputs = {
  project: ProjectState;
  store: Pick<ProjectStore, "refuseReadOnlyEdit" | "commitProjectChange">;
  media: Pick<
    AppMedia,
    | "mediaItems"
    | "mediaItemsById"
    | "remoteMediaProgress"
    | "peerMedia"
    | "seedLocalMediaItems"
    | "cacheLocalMediaItems"
    | "adoptMediaBlob"
  >;
  collaboration: Pick<
    CollaborationStateResult,
    "collaborationMode" | "collaborationState"
  >;
  mainAudioModel: Pick<
    ReturnType<typeof useMainAudio>,
    "setIsMainAudioDropTarget" | "replaceMainAudioFromFile"
  >;
  timelineClips: ArrangementClip[];
  setSourceTracksCollapsed: (collapsed: boolean) => void;
  appShellRef: RefObject<HTMLDivElement | null>;
  setStatus: Dispatch<SetStateAction<string>>;
};

// The session's offline media and sync progress (useMediaStatus), importing
// and relinking media (useMediaLibraryCommands), and dropping files on the
// source tracks and the Audio lane.
export function useMediaImport({
  project,
  store,
  media,
  collaboration,
  mainAudioModel,
  timelineClips,
  setSourceTracksCollapsed,
  appShellRef,
  setStatus,
}: MediaImportInputs) {
  const {
    mediaItems: projectMediaItems,
    sourceSpans,
    mainAudioId,
  } = project;
  const { refuseReadOnlyEdit, commitProjectChange } = store;
  const {
    mediaItems,
    mediaItemsById,
    remoteMediaProgress,
    peerMedia,
    seedLocalMediaItems,
    cacheLocalMediaItems,
    adoptMediaBlob,
  } = media;
  const { collaborationMode, collaborationState } = collaboration;
  const { setIsMainAudioDropTarget, replaceMainAudioFromFile } = mainAudioModel;

  const mediaStatus = useMediaStatus({
    mediaItems,
    timelineClips,
    sourceSpans,
    mainAudioId,
    remoteMediaProgress,
    peerMediaMissIds: peerMedia.peerMediaMissIds,
    failedSampleMediaIds: peerMedia.failedSampleMediaIds,
    collaborationMode,
    collaborationState,
  });
  const mediaCommands = useMediaLibraryCommands({
    projectMediaItems,
    refuseReadOnlyEdit,
    commitProjectChange,
    seedLocalMediaItems,
    cacheLocalMediaItems,
    setSourceTracksCollapsed,
    offlineMedia: mediaStatus.offlineMedia,
    mediaItemsById,
    adoptMediaBlob,
    setStatus,
  });
  const sourceTrackDrop = useSourceTrackDrop({
    mediaItems,
    appShellRef,
    setIsMainAudioDropTarget,
    importMediaIntoSourceTrack: mediaCommands.importMediaIntoSourceTrack,
    setStatus,
  });
  const mainAudioDrop = useMainAudioDrop({
    isSourceTrackFileDragActive: sourceTrackDrop.isSourceTrackFileDragActive,
    clearSourceTrackDragState: sourceTrackDrop.clearSourceTrackDragState,
    setIsMainAudioDropTarget,
    replaceMainAudioFromFile,
    setStatus,
  });

  return { ...mediaStatus, ...mediaCommands, sourceTrackDrop, mainAudioDrop };
}
