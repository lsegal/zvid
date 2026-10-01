import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  buildOrderLayerOptions,
  getFxClip,
  getFxClipScope,
  getFxKind,
  getPlayheadVisualLaneIds,
  getSelectedFxClipRank,
  isBeneathFxClipRank,
} from "../app/fx-panel-model.ts";
import type { ArrangementClip, Lane } from "../app/types.ts";
import { getFxPanelTitle, resolveSelectedLaneId } from "../fx-chain";
import { mapSessionEffectsToDevices, type SessionEffect } from "../fx-stack";
import type { MediaItem } from "../media";
import { getMissingFonts, subscribeFonts } from "../text-fonts.ts";

export type FxPanelModelInputs = {
  lanes: Lane[];
  effects: SessionEffect[];
  selectedLaneId: string | undefined;
  selectedClip: ArrangementClip | undefined;
  // A source track or clip is selected instead of a layer or clip.
  isSourceSelected: boolean;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  lanePriority: ReadonlyMap<string, number>;
  timelineClips: ArrangementClip[];
  playheadQ: number;
  bpm: number;
};

// The FX panel's layer, clip, devices and Order layer lists for the current
// selection.
export function useFxPanelModel({
  lanes,
  effects,
  selectedLaneId,
  selectedClip,
  isSourceSelected,
  mediaItemsById,
  lanePriority,
  timelineClips,
  playheadQ,
  bpm,
}: FxPanelModelInputs) {
  // A source selection has no layer, so the panel shows no layer's effects.
  const fxLaneId = useMemo(
    () =>
      isSourceSelected
        ? undefined
        : resolveSelectedLaneId(lanes, effects, selectedLaneId, selectedClip),
    [effects, isSourceSelected, selectedClip, lanes, selectedLaneId],
  );
  const fxLane = lanes.find((lane) => lane.id === fxLaneId);
  const fxKind = getFxKind(selectedClip, mediaItemsById);
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
  const fxClipName = fxClip?.name;
  const fxClipScope = getFxClipScope(selectedClip);
  const fxDevices = useMemo(
    () =>
      fxLaneId
        ? mapSessionEffectsToDevices(
            effects,
            fxLaneId,
            fxLane?.name,
            playheadVisualLayerIds,
            missingFonts,
            fxClipId,
            fxClipScope,
            fxClipLayerIds,
          )
        : [],
    [
      effects,
      fxClipId,
      fxClipLayerIds,
      fxClipScope,
      fxLane?.name,
      fxLaneId,
      missingFonts,
      playheadVisualLayerIds,
    ],
  );
  const fxPanelTitle = getFxPanelTitle(fxLane?.name, fxClipName);

  return {
    fxLaneId,
    fxLane,
    fxKind,
    fxClipId,
    fxClipName,
    fxClipScope,
    orderLayerOptions,
    fxClipLayerOptions,
    missingFonts,
    fxDevices,
    fxPanelTitle,
  };
}
