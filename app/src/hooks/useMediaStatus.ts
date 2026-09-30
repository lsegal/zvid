import { useMemo } from "react";
import {
  describeSessionMediaStatus,
  isInSharedMediaSession,
  listSessionMediaSync,
  listSessionOfflineMedia,
} from "../app/media-status.ts";
import type {
  ArrangementClip,
  CollaborationMode,
  SourceSpan,
} from "../app/types.ts";
import type { CollaborationConnectionState } from "../collaboration";
import type { MediaItem } from "../media";
import { mediaSyncLabel, summarizeMediaSync } from "../media-sync.ts";
import type { PeerMediaProgressMap } from "../peer-media-sync.ts";

export type MediaStatusInputs = {
  mediaItems: MediaItem[];
  timelineClips: ArrangementClip[];
  sourceSpans: SourceSpan[];
  mainAudioId: string | undefined;
  peerMediaProgress: PeerMediaProgressMap;
  peerMediaMissIds: ReadonlySet<string>;
  collaborationMode: CollaborationMode;
  collaborationState: CollaborationConnectionState;
};

// The session's offline media and peer sync progress, as the header, the
// media dialogs and the status bar show them.
export function useMediaStatus({
  mediaItems,
  timelineClips,
  sourceSpans,
  mainAudioId,
  peerMediaProgress,
  peerMediaMissIds,
  collaborationMode,
  collaborationState,
}: MediaStatusInputs) {
  const offlineMedia = useMemo(
    () => listSessionOfflineMedia(mediaItems, timelineClips, sourceSpans),
    [mediaItems, sourceSpans, timelineClips],
  );
  const inSharedMediaSession = isInSharedMediaSession(
    collaborationMode,
    collaborationState,
  );
  const mediaSyncEntries = useMemo(
    () =>
      listSessionMediaSync({
        mediaItems,
        timelineClips,
        sourceSpans,
        mainAudioId,
        progress: peerMediaProgress,
        misses: peerMediaMissIds,
        inSharedSession: inSharedMediaSession,
      }),
    [
      inSharedMediaSession,
      mainAudioId,
      mediaItems,
      peerMediaMissIds,
      peerMediaProgress,
      sourceSpans,
      timelineClips,
    ],
  );
  const mediaSyncSummary = useMemo(
    () => summarizeMediaSync(mediaSyncEntries),
    [mediaSyncEntries],
  );
  const mediaSyncStatusLabel = mediaSyncLabel(mediaSyncSummary);
  const offlineCount = mediaSyncSummary.offline;
  const sessionMediaStatus = useMemo(
    () => describeSessionMediaStatus(mediaItems),
    [mediaItems],
  );

  return {
    offlineMedia,
    inSharedMediaSession,
    mediaSyncEntries,
    mediaSyncSummary,
    mediaSyncStatusLabel,
    offlineCount,
    sessionMediaStatus,
  };
}
