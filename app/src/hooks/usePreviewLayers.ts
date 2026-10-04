import { useCallback, useMemo } from "react";
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
} from "../fx-stack.ts";
import { resolvePreviewLayers } from "../preview-edit.ts";
import type { MeterSignature } from "../timeline-format.ts";

type PreviewLayersInputs = {
  clips: ArrangementClip[];
  mediaItemsById: Map<string, MediaItem>;
  playheadQ: number;
  bpm: number;
  fps: number;
  signature: MeterSignature;
  projectDurationFrames: number | undefined;
  lanes: Lane[];
  lanePriority: Map<string, number>;
  effects: SessionEffect[];
  canvasWidth: number;
  canvasHeight: number;
};

// The video layers at `playheadQ`, placed as the compositor draws them.
export function resolvePreviewLayersAt(
  {
    clips,
    mediaItemsById,
    bpm,
    fps,
    signature,
    projectDurationFrames,
    lanes,
    lanePriority,
    effects,
    canvasWidth,
    canvasHeight,
  }: Omit<PreviewLayersInputs, "playheadQ">,
  playheadQ: number,
) {
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
    signature,
  );
  return resolvePreviewLayers(
    // Clips a Transition holds aren't at the playhead to edit.
    activeClips.filter((entry) => entry.media.kind === "video" && !entry.held),
    { width: canvasWidth, height: canvasHeight },
    // Animated with the topmost clip, as the compositor draws it.
    resolveAnimatedOrder(
      resolveFrameEffects(effects, activeClips, playheadQ, bpm, fps, signature),
      GLOBAL_EFFECT_TRACK_ID,
      fps,
    ),
  );
}

// The video layers the preview's transform overlay outlines at the
// playhead, placed as the compositor draws them, and the same layers resolved
// at any other playhead, for the overlay to follow the live playhead between
// commits.
export function usePreviewLayers({
  clips,
  mediaItemsById,
  playheadQ,
  bpm,
  fps,
  signature,
  projectDurationFrames,
  lanes,
  lanePriority,
  effects,
  canvasWidth,
  canvasHeight,
}: PreviewLayersInputs) {
  const resolveLayersAt = useCallback(
    (atQ: number) =>
      resolvePreviewLayersAt(
        {
          clips,
          mediaItemsById,
          bpm,
          fps,
          signature,
          projectDurationFrames,
          lanes,
          lanePriority,
          effects,
          canvasWidth,
          canvasHeight,
        },
        atQ,
      ),
    [
      bpm,
      canvasHeight,
      canvasWidth,
      clips,
      effects,
      fps,
      lanePriority,
      lanes,
      mediaItemsById,
      projectDurationFrames,
      signature,
    ],
  );
  const layers = useMemo(
    () => resolveLayersAt(playheadQ),
    [playheadQ, resolveLayersAt],
  );
  return { layers, resolveLayersAt };
}
