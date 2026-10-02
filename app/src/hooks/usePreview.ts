import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  findClipAtPlayhead,
  isClipAtPlayhead,
  quartersToSeconds,
} from "../app/timeline-math.ts";
import { signatureById } from "../app/constants.ts";
import type { ProjectState } from "../app/types.ts";
import { resolveAudioClips } from "../audio-mix/resolve.ts";
import {
  describeClipMediaState,
  describeMediaAvailability,
  isGeneratedClip,
} from "../clip-media-state";
import type { MediaItem } from "../media";
import { isSourceRenderId, resolveRenderClips } from "../render-clips.ts";
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
    sourceTracks,
    sourceSpans,
    signatureId,
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
  // What the compositor draws: the layer clips, or the source tracks when
  // there are none (see resolveRenderClips).
  const render = useMemo(
    () =>
      resolveRenderClips({
        clips: timelineClips,
        lanes,
        sourceTracks,
        sourceSpans,
        bpm,
        effects: timelineEffects,
      }),
    [bpm, lanes, sourceSpans, sourceTracks, timelineClips, timelineEffects],
  );
  // What the preview hears, resolved apart from what it draws.
  // Bumped by the Audio row's Refresh, which resolves the mix again so its
  // waveform and the reactive bands are measured again, such as after media
  // finishes relinking.
  const [audioMixRevision, setAudioMixRevision] = useState(0);
  const refreshAudioMix = useCallback(() => {
    setAudioMixRevision((revision) => revision + 1);
  }, []);
  const audioMix = useMemo(() => {
    void audioMixRevision;
    return resolveAudioClips({
      clips: timelineClips,
      lanes,
      sourceTracks,
      sourceSpans,
      mediaById: mediaItemsById,
      bpm,
      signature: signatureById(signatureId),
      effects: timelineEffects,
    });
  }, [
    audioMixRevision,
    bpm,
    lanes,
    mediaItemsById,
    signatureId,
    sourceSpans,
    sourceTracks,
    timelineClips,
    timelineEffects,
  ]);
  const renderLanePriority = useMemo(
    () =>
      render.fromSourceTracks
        ? new Map(render.lanes.map((lane, index) => [lane.id, index]))
        : lanePriority,
    [lanePriority, render],
  );
  const playheadClip = useMemo(
    () => findClipAtPlayhead(render.clips, playheadQ, bpm, renderLanePriority),
    [bpm, playheadQ, render, renderLanePriority],
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
      render.clips.some(
        (clip) =>
          isClipAtPlayhead(clip, playheadQ, bpm) &&
          (isGeneratedClip(clip) ||
            describeMediaAvailability(
              clip.mediaId
                ? mediaItemsById.get(clip.mediaId)?.availability
                : undefined,
            ) === "online"),
      ),
    [bpm, mediaItemsById, playheadQ, render],
  );
  const renderedLayers = usePreviewLayers({
    clips: render.clips,
    mediaItemsById,
    playheadQ,
    bpm,
    fps,
    projectDurationFrames,
    lanes: render.lanes,
    lanePriority: renderLanePriority,
    effects: render.effects,
    canvasWidth,
    canvasHeight,
  });
  // Source tracks rendered in place of layers are render-only: the
  // transform overlay can't select or edit them.
  const previewLayers = useMemo(
    () => renderedLayers.filter((layer) => !isSourceRenderId(layer.laneId)),
    [renderedLayers],
  );
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
    renderClips: render.clips,
    renderLanes: render.lanes,
    renderEffects: render.effects,
    renderFromSourceTracks: render.fromSourceTracks,
    audioMix,
    refreshAudioMix,
    previewMedia,
    previewMediaState,
    hasOnlinePlayheadClip,
    playheadSeconds,
  };
}
