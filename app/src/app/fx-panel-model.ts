// What the FX panel shows for the current selection: the layer and clip
// whose stacks it edits, and the layers an Order device lists.
import { describeMediaAvailability } from "../clip-media-state.ts";
import { type FxLayerOption, getFxClipName } from "../fx-chain.ts";
import { FX_CLIP_LABEL, isFxClip } from "../fx-clip.ts";
import {
  clipEffectTrackId,
  isLayerFxEnabled,
  type SessionEffect,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx-stack.ts";
import type { MediaItem } from "../media.ts";
import { isTextClip } from "../text-clip.ts";
import { getTextPreview, resolveTextStyle } from "../text-style.ts";
import type { SourceSelection } from "./source-selection.ts";
import { isClipAtPlayhead } from "./timeline-math.ts";
import type {
  ArrangementClip,
  Lane,
  SourceSpan,
  SourceTrack,
} from "./types.ts";
import { getSwatch } from "./util.ts";

// Audio clips have no visual effects; that only applies while one is
// selected, not to the layer on its own.
export function getFxKind(
  selectedClip: ArrangementClip | undefined,
  mediaItemsById: ReadonlyMap<string, MediaItem>,
) {
  return selectedClip?.mediaId
    ? mediaItemsById.get(selectedClip.mediaId)?.kind
    : undefined;
}

// Layers the compositor draws at the playhead: one per layer with an
// online video clip there. The Order device warns when a grid hides some.
export function getPlayheadVisualLaneIds(
  timelineClips: readonly ArrangementClip[],
  mediaItemsById: ReadonlyMap<string, MediaItem>,
  playheadQ: number,
  bpm: number,
) {
  return new Set(
    timelineClips
      .filter((clip) => {
        const media = clip.mediaId
          ? mediaItemsById.get(clip.mediaId)
          : undefined;
        return (
          media?.kind === "video" &&
          isClipAtPlayhead(clip, playheadQ, bpm) &&
          describeMediaAvailability(media.availability) === "online"
        );
      })
      .map((clip) => clip.laneId),
  );
}

// The selected FX clip's layer rank, when an FX clip is selected.
export function getSelectedFxClipRank(
  selectedClip: ArrangementClip | undefined,
  lanePriority: ReadonlyMap<string, number>,
) {
  return isFxClip(selectedClip)
    ? lanePriority.get(selectedClip?.laneId ?? "")
    : undefined;
}

// Whether a layer lies beneath the selected FX clip, so an Order on it
// arranges that layer.
export function isBeneathFxClipRank(
  lanePriority: ReadonlyMap<string, number>,
  selectedFxClipRank: number | undefined,
  laneId: string,
) {
  return (
    selectedFxClipRank !== undefined &&
    (lanePriority.get(laneId) ?? -1) > selectedFxClipRank
  );
}

// The layers an Order's Layers menu lists, in timeline order.
export function buildOrderLayerOptions(
  lanes: readonly Lane[],
): FxLayerOption[] {
  return lanes.map((lane, index) => ({
    id: lane.id,
    number: index + 1,
    name: lane.name,
    color: lane.colorIndex >= 0 ? getSwatch(lane.colorIndex).accent : undefined,
  }));
}

// The clip whose own stack the FX chain shows: only an explicitly
// selected clip, on the layer the chain shows.
export function getFxClip(
  selectedClip: ArrangementClip | undefined,
  fxLaneId: string | undefined,
  effects: readonly SessionEffect[],
) {
  return selectedClip && selectedClip.laneId === fxLaneId
    ? {
        id: selectedClip.id,
        name: getFxClipName(
          selectedClip.label,
          isTextClip(selectedClip)
            ? getTextPreview(
                resolveTextStyle(
                  effects,
                  selectedClip.laneId,
                  clipEffectTrackId(selectedClip.id),
                ),
              )
            : isFxClip(selectedClip)
              ? FX_CLIP_LABEL
              : undefined,
        ),
      }
    : undefined;
}

// An FX clip's own stack offers only effects that work on a composite.
export function getFxClipScope(
  selectedClip: ArrangementClip | undefined,
): "fxClip" | "clip" {
  return isFxClip(selectedClip) ? "fxClip" : "clip";
}

// The stacks the FX chain shows for a source selection, in place of a
// layer's and a layer clip's: the source track's own stack, and the
// selected source clip's, which its FX switch bypasses like a layer's.
// Undefined when no source track or clip is selected.
export function getSourceFxStacks(
  selection: SourceSelection | undefined,
  sourceTracks: readonly Pick<SourceTrack, "id" | "name" | "fxEnabled">[],
  sourceSpans: readonly Pick<SourceSpan, "id" | "label" | "mediaId">[],
) {
  if (!selection) {
    return undefined;
  }

  const track = sourceTracks.find(
    (candidate) => candidate.id === selection.sourceTrackId,
  );
  const span =
    selection.sourceSpanId === undefined
      ? undefined
      : sourceSpans.find(
          (candidate) => candidate.id === selection.sourceSpanId,
        );
  return {
    trackId: track?.id,
    trackStackId: track ? sourceTrackEffectTrackId(track.id) : undefined,
    trackName: track?.name,
    trackFxEnabled: isLayerFxEnabled(track),
    clipStackId: span ? sourceClipEffectTrackId(span.id) : undefined,
    clipName: span ? getFxClipName(span.label) : undefined,
    mediaId: span?.mediaId,
  };
}
