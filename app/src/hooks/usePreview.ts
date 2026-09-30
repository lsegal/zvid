import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
} from "react";
import {
  findClipAtPlayhead,
  isClipAtPlayhead,
  quartersToSeconds,
} from "../app/timeline-math.ts";
import type { ProjectState } from "../app/types.ts";
import {
  describeClipMediaState,
  describeMediaAvailability,
  isGeneratedClip,
} from "../clip-media-state";
import type { MediaItem } from "../media";
import { loadFontFace, resolveFontFace } from "../text-fonts.ts";
import { isTextEffectName, readTextStyle } from "../text-style.ts";
import {
  type PreviewEditingInputs,
  usePreviewEditing,
} from "./usePreviewEditing.ts";
import { usePreviewLayers } from "./usePreviewLayers.ts";
import type { TimelineSelectionState } from "./useTimelineSelection.ts";

export type PreviewInputs = {
  project: ProjectState;
  selection: Pick<
    TimelineSelectionState,
    | "inspectorClip"
    | "selectedClipId"
    | "setPreviewLaneId"
    | "setSelectedClipId"
    | "setSelectedLaneId"
    | "timelineClips"
    | "timelineClipsRef"
    | "timelineEffects"
  >;
  mediaItemsById: Map<string, MediaItem>;
  lanePriority: Map<string, number>;
  editEffects: PreviewEditingInputs["editEffects"];
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  playbackOriginRef: RefObject<number>;
  playheadQ: number;
  playheadQRef: RefObject<number>;
  setPlayheadQ: (nextQ: number) => void;
  refuseReadOnlyEdit: () => boolean;
};

// What the preview shows at the playhead: the clip it describes and its
// media, the layers the transform overlay outlines, and editing those layers
// and text in place (usePreviewEditing). Also loads the fonts text clips use.
export function usePreview({
  project,
  selection,
  mediaItemsById,
  lanePriority,
  editEffects,
  isPlaying,
  setIsPlaying,
  playbackOriginRef,
  playheadQ,
  playheadQRef,
  setPlayheadQ,
  refuseReadOnlyEdit,
}: PreviewInputs) {
  const {
    bpm,
    fps,
    canvasWidth,
    canvasHeight,
    lanes,
    effects,
    projectDurationFrames,
  } = project;
  const {
    inspectorClip,
    selectedClipId,
    setPreviewLaneId,
    setSelectedClipId,
    setSelectedLaneId,
    timelineClips,
    timelineClipsRef,
    timelineEffects,
  } = selection;
  const playheadClip = useMemo(
    () => findClipAtPlayhead(timelineClips, playheadQ, bpm, lanePriority),
    [bpm, lanePriority, playheadQ, timelineClips],
  );
  const previewClip = playheadClip ?? inspectorClip;
  const previewMedia = previewClip?.mediaId
    ? mediaItemsById.get(previewClip.mediaId)
    : undefined;
  const previewMediaState = previewClip
    ? describeClipMediaState(previewClip, previewMedia?.availability)
    : "offline";
  // The compositor draws every online layer at the playhead, so an offline
  // clip on one layer only covers the preview when no layer can be drawn.
  const hasOnlinePlayheadClip = useMemo(
    () =>
      timelineClips.some(
        (clip) =>
          isClipAtPlayhead(clip, playheadQ, bpm) &&
          (isGeneratedClip(clip) ||
            describeMediaAvailability(
              clip.mediaId
                ? mediaItemsById.get(clip.mediaId)?.availability
                : undefined,
            ) === "online"),
      ),
    [bpm, mediaItemsById, playheadQ, timelineClips],
  );
  const previewLayers = usePreviewLayers({
    clips: timelineClips,
    mediaItemsById,
    playheadQ,
    bpm,
    fps,
    projectDurationFrames,
    lanes,
    lanePriority,
    effects: timelineEffects,
    canvasWidth,
    canvasHeight,
  });
  const previewEditing = usePreviewEditing({
    bpm,
    editEffects,
    effects,
    isPlaying,
    lanes,
    playbackOriginRef,
    playheadQRef,
    previewLayers,
    refuseReadOnlyEdit,
    selectedClipId,
    setIsPlaying,
    setPlayheadQ,
    setPreviewLaneId,
    setSelectedClipId,
    setSelectedLaneId,
    timelineClipsRef,
  });
  useEffect(() => {
    for (const effect of effects) {
      if (effect.enabled !== false && isTextEffectName(effect.effectName)) {
        const style = readTextStyle(effect);
        void loadFontFace(
          resolveFontFace(style.font, style.weight, style.italic, new Set()),
        );
      }
    }
  }, [effects]);
  const playheadSeconds = quartersToSeconds(playheadQ, bpm);

  return {
    ...previewEditing,
    previewLayers,
    previewClip,
    previewMedia,
    previewMediaState,
    hasOnlinePlayheadClip,
    playheadSeconds,
  };
}
