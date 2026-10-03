import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  buildOrderLayerOptions,
  getFxClip,
  getFxClipScope,
  getFxKind,
  getPlayheadVisualLaneIds,
  getSelectedFxClipRank,
  getSourceFxStacks,
  isBeneathFxClipRank,
} from "../app/fx-panel-model.ts";
import type { SourceSelection } from "../app/source-selection.ts";
import type {
  ArrangementClip,
  Lane,
  SourceSpan,
  SourceTrack,
} from "../app/types.ts";
import { getFxPanelTitle, resolveSelectedLaneId } from "../fx-chain";
import {
  clipEffectTrackId,
  isLayerFxEnabled,
  mapSessionEffectsToDevices,
  type SessionEffect,
} from "../fx-stack";
import type { MediaItem } from "../media";
import { getMissingFonts, subscribeFonts } from "../text-fonts.ts";

export type FxPanelModelInputs = {
  lanes: Lane[];
  effects: SessionEffect[];
  selectedLaneId: string | undefined;
  selectedClip: ArrangementClip | undefined;
  // The source track or clip selected instead of a layer or clip.
  sourceSelection: SourceSelection | undefined;
  sourceTracks: SourceTrack[];
  sourceSpans: SourceSpan[];
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  lanePriority: ReadonlyMap<string, number>;
  timelineClips: ArrangementClip[];
  playheadQ: number;
  bpm: number;
};

// The FX panel's layer, clip, devices and Order layer lists for the current
// selection. A source selection shows its source track's and source clip's
// stacks in place of a layer's and a layer clip's.
export function useFxPanelModel({
  lanes,
  effects,
  selectedLaneId,
  selectedClip,
  sourceSelection,
  sourceTracks,
  sourceSpans,
  mediaItemsById,
  lanePriority,
  timelineClips,
  playheadQ,
  bpm,
}: FxPanelModelInputs) {
  const sourceStacks = useMemo(
    () => getSourceFxStacks(sourceSelection, sourceTracks, sourceSpans),
    [sourceSelection, sourceSpans, sourceTracks],
  );
  // A source selection has no layer, so the panel shows no layer's effects.
  const fxLaneId = useMemo(
    () =>
      sourceStacks
        ? undefined
        : resolveSelectedLaneId(lanes, effects, selectedLaneId, selectedClip),
    [effects, sourceStacks, selectedClip, lanes, selectedLaneId],
  );
  const fxLane = lanes.find((lane) => lane.id === fxLaneId);
  const fxKind = sourceStacks
    ? sourceStacks.mediaId
      ? mediaItemsById.get(sourceStacks.mediaId)?.kind
      : undefined
    : getFxKind(selectedClip, mediaItemsById);
  const playheadVisualLaneIds = useMemo(
    () =>
      getPlayheadVisualLaneIds(timelineClips, mediaItemsById, playheadQ, bpm),
    [bpm, mediaItemsById, playheadQ, timelineClips],
  );
  const playheadVisualLayerIds = useMemo(
    () => [...playheadVisualLaneIds],
    [playheadVisualLaneIds],
  );
  // Of those, the layers beneath the selected FX clip, which an Order on it
  // arranges.
  const selectedFxClipRank = getSelectedFxClipRank(selectedClip, lanePriority);
  const isBeneathSelectedFxClip = useCallback(
    (laneId: string) =>
      isBeneathFxClipRank(lanePriority, selectedFxClipRank, laneId),
    [lanePriority, selectedFxClipRank],
  );
  const fxClipLayerIds = useMemo(
    () => playheadVisualLayerIds.filter(isBeneathSelectedFxClip),
    [isBeneathSelectedFxClip, playheadVisualLayerIds],
  );
  // The layers an Order's Layers menu lists, in timeline order: every
  // layer for the Global Order, and those beneath the FX clip for its own.
  const orderLayerOptions = useMemo(
    () => buildOrderLayerOptions(lanes),
    [lanes],
  );
  const fxClipLayerOptions = useMemo(
    () =>
      orderLayerOptions.filter((layer) => isBeneathSelectedFxClip(layer.id)),
    [isBeneathSelectedFxClip, orderLayerOptions],
  );
  // Fonts Text effects pick load up front, so one that can't be loaded is
  // flagged on its device even before its clip is drawn.
  const missingFonts = useSyncExternalStore(subscribeFonts, getMissingFonts);
  const fxClip = getFxClip(selectedClip, fxLaneId, effects);
  const fxClipId = fxClip?.id;
  const fxClipScope = getFxClipScope(selectedClip);
  // The stacks the chain's Layer (or Track) and Clip sections show.
  const fxLayerTrackId = sourceStacks ? sourceStacks.trackStackId : fxLaneId;
  const fxLayerName = sourceStacks ? sourceStacks.trackName : fxLane?.name;
  const fxClipTrackId = sourceStacks
    ? sourceStacks.clipStackId
    : fxClipId === undefined
      ? undefined
      : clipEffectTrackId(fxClipId);
  const fxClipName = sourceStacks ? sourceStacks.clipName : fxClip?.name;
  const fxDevices = useMemo(
    () =>
      fxLayerTrackId
        ? mapSessionEffectsToDevices(
            effects,
            fxLayerTrackId,
            fxLayerName,
            playheadVisualLayerIds,
            missingFonts,
            fxClipTrackId,
            fxClipScope,
            fxClipLayerIds,
          )
        : [],
    [
      effects,
      fxClipLayerIds,
      fxClipScope,
      fxClipTrackId,
      fxLayerName,
      fxLayerTrackId,
      missingFonts,
      playheadVisualLayerIds,
    ],
  );
  const fxPanelTitle = getFxPanelTitle(fxLayerName, fxClipName);

  return {
    fxLaneId,
    fxLane,
    fxKind,
    fxClipId,
    fxClipName,
    fxClipScope,
    fxLayerTrackId,
    fxLayerName,
    // A source selection's track-level section is its source track's.
    fxLayerLabel: sourceStacks ? "Track" : "Layer",
    // The selected source track, whose FX switch the chain's "FX off"
    // banner turns back on in place of a layer's.
    fxSourceTrackId: sourceStacks?.trackId,
    // The selected source track whose Record device the Track section
    // leads with.
    fxRecordTrack: sourceStacks?.trackId
      ? { trackId: sourceStacks.trackId, trackName: sourceStacks.trackName }
      : undefined,
    fxLayerFxEnabled: sourceStacks
      ? sourceStacks.trackFxEnabled
      : isLayerFxEnabled(fxLane),
    fxClipTrackId,
    orderLayerOptions,
    fxClipLayerOptions,
    missingFonts,
    fxDevices,
    fxPanelTitle,
  };
}
