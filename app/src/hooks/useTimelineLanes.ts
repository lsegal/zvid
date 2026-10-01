import { useMemo } from "react";
import type { ArrangementClip, Lane, SourceSpan } from "../app/types.ts";
import { pluralize } from "../app/util.ts";
import {
  isLayerFxEnabled,
  isLayoutEffectName,
  type SessionEffect,
} from "../fx-stack";

export type LaneStatus = {
  effectCount: number;
  fxTitle: string;
  summary: string;
};

export type TimelineLanesInputs = {
  lanes: Lane[];
  timelineClips: ArrangementClip[];
  sourceSpans: SourceSpan[];
  effects: SessionEffect[];
};

// The timeline's clips grouped by layer and source spans by source track,
// with each layer header's summary and FX badge.
export function useTimelineLanes({
  lanes,
  timelineClips,
  sourceSpans,
  effects,
}: TimelineLanesInputs) {
  const clipsByLane = useMemo(() => {
    const next = new Map<string, ArrangementClip[]>();
    for (const clip of timelineClips) {
      const laneClips = next.get(clip.laneId);
      if (laneClips) {
        laneClips.push(clip);
        continue;
      }

      next.set(clip.laneId, [clip]);
    }
    return next;
  }, [timelineClips]);
  const laneStatusById = useMemo(() => {
    const next = new Map<string, LaneStatus>();
    for (const lane of lanes) {
      const clipCount = clipsByLane.get(lane.id)?.length ?? 0;
      // The Layout every layer has is not counted, and layer FX bypass
      // leaves it on anyway.
      const effectCount = effects.filter(
        (effect) =>
          effect.trackId === lane.id && !isLayoutEffectName(effect.effectName),
      ).length;
      const fxEnabled = isLayerFxEnabled(lane);
      const summary = [
        clipCount ? pluralize(clipCount, "clip") : "",
        !fxEnabled
          ? "FX off"
          : effectCount
            ? pluralize(effectCount, "effect")
            : "",
      ]
        .filter(Boolean)
        .join(" · ");
      next.set(lane.id, {
        effectCount,
        fxTitle: `Turn ${lane.name} FX ${fxEnabled ? "off" : "on"}`,
        summary: summary || "Empty",
      });
    }
    return next;
  }, [clipsByLane, effects, lanes]);
  const sourceSpansByTrack = useMemo(() => {
    const next = new Map<string, SourceSpan[]>();
    for (const clip of sourceSpans) {
      const trackClips = next.get(clip.sourceTrackId);
      if (trackClips) {
        trackClips.push(clip);
        continue;
      }

      next.set(clip.sourceTrackId, [clip]);
    }
    return next;
  }, [sourceSpans]);

  return { clipsByLane, laneStatusById, sourceSpansByTrack };
}
