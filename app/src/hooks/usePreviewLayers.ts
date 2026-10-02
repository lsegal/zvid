import { useMemo } from "react";
import type { ArrangementClip, Lane } from "../app/types.ts";
import {
  computeActiveClips,
  type MediaItem,
  resolveAnimatedOrder,
  resolveFrameEffects,
} from "../composition-active-clips.ts";
import {
  GLOBAL_EFFECT_TRACK_ID,
  getRenderedEffects,
  type SessionEffect,
} from "../fx-stack";
import { resolvePreviewLayers } from "../preview-edit.ts";

type PreviewLayersInputs = {
  clips: ArrangementClip[];
  mediaItemsById: Map<string, MediaItem>;
  playheadQ: number;
  bpm: number;
  fps: number;
  projectDurationFrames: number | undefined;
  lanes: Lane[];
  lanePriority: Map<string, number>;
  effects: SessionEffect[];
  canvasWidth: number;
  canvasHeight: number;
};

// The video layers the preview's transform overlay outlines at the
// playhead, placed as the compositor draws them.
export function usePreviewLayers({
  clips,
  mediaItemsById,
  playheadQ,
  bpm,
  fps,
  projectDurationFrames,
  lanes,
  lanePriority,
  effects,
  canvasWidth,
  canvasHeight,
}: PreviewLayersInputs) {
  return useMemo(() => {
    const activeClips = computeActiveClips(
      clips,
      mediaItemsById,
      playheadQ,
      bpm,
      lanePriority,
      getRenderedEffects(effects, lanes, clips),
      fps,
      undefined,
      projectDurationFrames,
    );
    return resolvePreviewLayers(
      activeClips.filter((entry) => entry.media.kind === "video"),
      { width: canvasWidth, height: canvasHeight },
      // Animated with the topmost clip, as the compositor draws it.
      resolveAnimatedOrder(
        resolveFrameEffects(effects, activeClips, playheadQ, bpm, fps),
        GLOBAL_EFFECT_TRACK_ID,
        fps,
      ),
    );
  }, [
    bpm,
    canvasHeight,
    canvasWidth,
    clips,
    effects,
    fps,
    lanePriority,
    lanes,
    mediaItemsById,
    playheadQ,
    projectDurationFrames,
  ]);
}
