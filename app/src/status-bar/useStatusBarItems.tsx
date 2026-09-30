import { type Dispatch, type SetStateAction, useMemo } from "react";
import { ShareLinkButton } from "../components/ShareLinkButton";
import type { StatusItem } from "../components/StatusBar";
import { StatusPlayhead } from "../components/StatusPlayhead";
import type { PlayheadSignal } from "../playhead-signal";
import { shareLinkVisible } from "../share-link";
import type {
  StatusAudioInfo,
  StatusCollaborationInfo,
  StatusTimelineMode,
} from "../status-items";
import type { MeterSignature } from "../timeline-format.ts";
import { ZVID_BUILD } from "../version";
import { buildStatusItems } from "./registry.ts";

export type StatusBarItemsInputs = {
  bpm: number;
  canvasHeight: number;
  canvasWidth: number;
  clipCount: number;
  collaborationMode: StatusCollaborationInfo["mode"];
  collaborationState: { connected: boolean; peerCount: number };
  fps: number;
  offlineCount: number;
  playheadSignal: PlayheadSignal;
  previewMedia: StatusAudioInfo | undefined;
  sessionName: string | null;
  setIsSessionSettingsOpen: Dispatch<SetStateAction<boolean>>;
  shareUrl: string;
  signature: MeterSignature;
  timelineMode: StatusTimelineMode;
  trackCount: number;
};

// The status bar items for the current app state, with the live playhead
// readout, the resolution opening Session Settings and the Copy share link
// button.
export function useStatusBarItems({
  bpm,
  canvasHeight,
  canvasWidth,
  clipCount,
  collaborationMode,
  collaborationState,
  fps,
  offlineCount,
  playheadSignal,
  previewMedia,
  sessionName,
  setIsSessionSettingsOpen,
  shareUrl,
  signature,
  timelineMode,
  trackCount,
}: StatusBarItemsInputs) {
  // Everything but the playhead is memoized off the playhead, and the playhead
  // cell subscribes to it on its own, so playback does not re-render the bar.
  const statusBarItems = useMemo<StatusItem[]>(
    () =>
      buildStatusItems({
        version: ZVID_BUILD,
        sessionName,
        timelineMode,
        // Unused: the playhead item is swapped for the live readout below.
        playheadQ: 0,
        bpm,
        signature,
        fps,
        canvasWidth,
        canvasHeight,
        audio: previewMedia ?? null,
        collaboration: {
          mode: collaborationMode,
          connected: collaborationState.connected,
          peerCount: collaborationState.peerCount,
        },
        clipCount,
        trackCount,
        offlineCount,
      }).flatMap((item): StatusItem[] => {
        if (item.id === "playhead") {
          return [
            {
              id: item.id,
              label: item.label,
              value: (
                <StatusPlayhead
                  bpm={bpm}
                  fps={fps}
                  signal={playheadSignal}
                  signature={signature}
                  timelineMode={timelineMode}
                />
              ),
            },
          ];
        }
        if (item.id === "resolution") {
          return [{ ...item, onClick: () => setIsSessionSettingsOpen(true) }];
        }
        // The Copy share link button sits right after the share status.
        if (
          item.id === "collaboration" &&
          shareLinkVisible(collaborationMode, shareUrl)
        ) {
          return [
            item,
            {
              id: "share-link",
              value: <ShareLinkButton key={shareUrl} url={shareUrl} />,
            },
          ];
        }
        return [item];
      }),
    [
      bpm,
      canvasHeight,
      canvasWidth,
      clipCount,
      collaborationMode,
      collaborationState.connected,
      collaborationState.peerCount,
      fps,
      offlineCount,
      playheadSignal,
      previewMedia,
      sessionName,
      setIsSessionSettingsOpen,
      shareUrl,
      signature,
      timelineMode,
      trackCount,
    ],
  );

  return statusBarItems;
}
