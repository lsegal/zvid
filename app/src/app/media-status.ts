// What the header, the media dialogs and the status bar say about the
// session's media: which files are offline and how peer syncing is going.
import { usesMediaFile } from "../clip-media-state.ts";
import type { CollaborationConnectionState } from "../collaboration.ts";
import type { MediaItem } from "../media.ts";
import { listMediaSync } from "../media-sync.ts";
import type { PeerMediaProgressMap } from "../peer-media-sync.ts";
import { listOfflineMedia } from "../relink.ts";
import type {
  ArrangementClip,
  CollaborationMode,
  SourceSpan,
} from "./types.ts";
import { pluralize } from "./util.ts";

// Arrangement and source-track clips both count, so sessions whose media
// is only used on source tracks still surface the Locate Media shortcut.
export function listSessionOfflineMedia(
  mediaItems: MediaItem[],
  timelineClips: ArrangementClip[],
  sourceSpans: SourceSpan[],
) {
  return listOfflineMedia(mediaItems, [...timelineClips, ...sourceSpans]);
}

// Media a peer may still send is syncing, not offline, so only files no
// connected peer could serve count toward the offline label. A joiner can
// receive the project over a peer connection before that peer's media
// channel opens, so any connected peer counts.
export function isInSharedMediaSession(
  collaborationMode: CollaborationMode,
  collaborationState: CollaborationConnectionState,
) {
  const { diagnostics: collaborationDiagnostics } = collaborationState;
  return (
    collaborationMode !== "idle" &&
    (collaborationState.mediaPeerCount > 0 ||
      collaborationDiagnostics.peersConnected > 0 ||
      collaborationDiagnostics.sameBrowserPeers > 0)
  );
}

export type SessionMediaSyncInputs = {
  mediaItems: MediaItem[];
  timelineClips: ArrangementClip[];
  sourceSpans: SourceSpan[];
  mainAudioId: string | undefined;
  progress: PeerMediaProgressMap;
  misses: ReadonlySet<string>;
  inSharedSession: boolean;
};

export function listSessionMediaSync({
  mediaItems,
  timelineClips,
  sourceSpans,
  mainAudioId,
  progress,
  misses,
  inSharedSession,
}: SessionMediaSyncInputs) {
  return listMediaSync({
    mediaItems,
    // Placeholder clips, such as MIDI imported from a Live set, never
    // had media, and fill clips need none, so there is no file to
    // report as offline.
    arrangementClips: timelineClips.filter(usesMediaFile),
    sourceClips: sourceSpans.filter(usesMediaFile),
    mainAudioId,
    progress,
    misses,
    inSharedSession,
  });
}

export function describeSessionMediaStatus(mediaItems: MediaItem[]) {
  if (!mediaItems.length) {
    return "No media";
  }

  const pendingCount = mediaItems.filter(
    (item) => item.availability !== "ready",
  ).length;
  return pendingCount
    ? `${pluralize(pendingCount, "media file")} not ready`
    : "Media linked";
}
