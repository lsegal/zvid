import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ArrangementClip, ProjectState } from "../app/types.ts";
import type { AppMedia } from "./useAppMedia.ts";
import type { CollaborationStateResult } from "./useCollaboration.ts";
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
  timelineClips: ArrangementClip[];
  setSourceTracksCollapsed: (collapsed: boolean) => void;
  appShellRef: RefObject<HTMLDivElement | null>;
  // Where on the timeline media dropped on a source track starts.
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  labelWidth: number;
  quarterPx: number;
  snapUnit: number;
  setStatus: Dispatch<SetStateAction<string>>;
};

// The session's offline media and sync progress (useMediaStatus), importing
// and relinking media (useMediaLibraryCommands), and dropping files on the
// source tracks.
export function useMediaImport({
  project,
  store,
  media,
  collaboration,
  timelineClips,
  setSourceTracksCollapsed,
  appShellRef,
  timelineScrollRef,
  labelWidth,
  quarterPx,
  snapUnit,
  setStatus,
}: MediaImportInputs) {
  const { mediaItems: projectMediaItems, sourceSpans, snapEnabled } = project;
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

  const mediaStatus = useMediaStatus({
    mediaItems,
    timelineClips,
    sourceSpans,
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
    timelineScrollRef,
    labelWidth,
    quarterPx,
    snapUnit,
    snapEnabled,
    importMediaIntoSourceTrack: mediaCommands.importMediaIntoSourceTrack,
    placeMediaInSourceTrack: mediaCommands.placeMediaInSourceTrack,
    setStatus,
  });
  return { ...mediaStatus, ...mediaCommands, sourceTrackDrop };
}
