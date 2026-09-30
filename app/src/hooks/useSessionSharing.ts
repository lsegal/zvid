import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
} from "react";
import { getClipEndQ } from "../app/timeline-math.ts";
import type { ArrangementClip, SourceSpan } from "../app/types.ts";
import type { MediaSyncPeer } from "../components/MediaSyncDialog";
import { offlineSessionMediaIds } from "../session-media.ts";
import type { AppMedia } from "./useAppMedia.ts";
import {
  type CollaborationStateResult,
  useCollaboration,
} from "./useCollaboration.ts";
import { usePeerMedia } from "./usePeerMedia.ts";
import type { ProjectStore } from "./useProjectStore.ts";
import type { TimelineSelectionState } from "./useTimelineSelection.ts";
import type { useTimelineViewport } from "./useTimelineViewport.ts";

export type SessionSharingInputs = {
  collaboration: CollaborationStateResult;
  store: Pick<
    ProjectStore,
    | "projectHistory"
    | "projectSnapshotRef"
    | "dispatchProjectHistory"
    | "playheadQ"
  >;
  selection: Pick<
    TimelineSelectionState,
    | "setDragPreviewClips"
    | "setDragState"
    | "setPendingSelection"
    | "setTimelineDragState"
  >;
  media: Pick<
    AppMedia,
    | "peerMedia"
    | "mediaItemsById"
    | "mediaHydrationTick"
    | "setMediaHydrationTick"
    | "mediaHydrationInFlightRef"
    | "setLocalMediaOverride"
    | "adoptMediaBlob"
  >;
  viewport: Pick<
    ReturnType<typeof useTimelineViewport>,
    "quarterPx" | "visibleTimelineStartPx" | "visibleTimelineEndPx"
  >;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  stopTimelineAudibleScrub: () => void;
  appShellRef: RefObject<HTMLDivElement | null>;
  flushWorkspaceSession: () => Promise<void>;
  viewingSharedSessionRef: { current: boolean };
  setStatus: Dispatch<SetStateAction<string>>;
};

// Sharing the session with collaborators (useCollaboration), fetching its
// offline media from them (usePeerMedia), and the peer the media sync
// dialog names.
export function useSessionSharing({
  collaboration,
  store,
  selection,
  media,
  viewport,
  setIsPlaying,
  stopTimelineAudibleScrub,
  appShellRef,
  flushWorkspaceSession,
  viewingSharedSessionRef,
  setStatus,
}: SessionSharingInputs) {
  const {
    collaborationMode,
    collaborationState,
    shareCopyResetTimeoutRef,
    collaborationControllerRef,
  } = collaboration;
  const { projectHistory, projectSnapshotRef, playheadQ } = store;
  const { bpm, clips, sourceSpans, mainAudioId } = projectHistory.present;
  const { peerMedia, mediaItemsById } = media;
  const { quarterPx, visibleTimelineStartPx, visibleTimelineEndPx } = viewport;

  const mediaSyncPeer = useMemo<MediaSyncPeer | undefined>(() => {
    const remote = collaborationState.collaborators.filter(
      (collaborator) => !collaborator.isLocal,
    );
    return remote.length === 1
      ? { name: remote[0].name, color: remote[0].color }
      : undefined;
  }, [collaborationState.collaborators]);
  // Every offline media the session references, in peer request order.
  // Serialized so the peer fetch effect only reruns when the list changes.
  const offlineSessionMediaIdsKey = useMemo(() => {
    const toRange = (clip: ArrangementClip | SourceSpan) => ({
      mediaId: clip.mediaId,
      startQ: clip.startQ,
      endQ: getClipEndQ(clip, bpm),
    });
    return JSON.stringify(
      offlineSessionMediaIds({
        availability: (mediaId) => mediaItemsById.get(mediaId)?.availability,
        mainAudioId,
        clips: clips.map(toRange),
        sourceSpans: sourceSpans.map(toRange),
        playheadQ,
        visibleStartQ: visibleTimelineStartPx / quarterPx,
        visibleEndQ: visibleTimelineEndPx / quarterPx,
      }),
    );
  }, [
    bpm,
    clips,
    mainAudioId,
    mediaItemsById,
    playheadQ,
    quarterPx,
    sourceSpans,
    visibleTimelineEndPx,
    visibleTimelineStartPx,
  ]);

  useEffect(
    () => () => {
      if (shareCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(shareCopyResetTimeoutRef.current);
      }
    },
    [shareCopyResetTimeoutRef],
  );

  const collaborationActions = useCollaboration({
    collaboration,
    projectState: projectHistory.present,
    projectSnapshotRef,
    dispatchProjectHistory: store.dispatchProjectHistory,
    setIsPlaying,
    stopTimelineAudibleScrub,
    setDragPreviewClips: selection.setDragPreviewClips,
    setDragState: selection.setDragState,
    setPendingSelection: selection.setPendingSelection,
    setTimelineDragState: selection.setTimelineDragState,
    appShellRef,
    resolvePeerMedia: peerMedia.resolvePeerMedia,
    abortPeerMediaTransfers: peerMedia.abortPeerMediaTransfers,
    flushWorkspaceSession,
    viewingSharedSessionRef,
    setStatus,
  });
  const { retryPeerMedia } = usePeerMedia({
    peerMedia,
    collaborationMode,
    collaborationControllerRef,
    mediaPeerCount: collaborationState.mediaPeerCount,
    mainAudioId,
    offlineSessionMediaIdsKey,
    mediaHydrationTick: media.mediaHydrationTick,
    setMediaHydrationTick: media.setMediaHydrationTick,
    mediaHydrationInFlightRef: media.mediaHydrationInFlightRef,
    projectSnapshotRef,
    setLocalMediaOverride: media.setLocalMediaOverride,
    adoptMediaBlob: media.adoptMediaBlob,
    setStatus,
  });

  return { ...collaborationActions, retryPeerMedia, mediaSyncPeer };
}
