import { isGeneratedClip } from "../clip-media-state.ts";
import type { MediaItem } from "../media.ts";
import { resolveClipOverlaps, withWindowTiming } from "../range-edit.ts";
import type {
  ArrangementClip,
  SourceSpan,
  TimelineSelection,
} from "./types.ts";

export function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm;
}

export function secondsToQuarters(seconds: number, bpm: number) {
  return (seconds * bpm) / 60;
}

export function snapQuarterValue(
  valueQ: number,
  snapUnit: number,
  enabled: boolean,
) {
  if (!enabled) {
    return valueQ;
  }

  return Math.round(valueQ / snapUnit) * snapUnit;
}

/**
 * The timeline position, in quarters, under a pointer `pointerX` pixels from
 * the timeline scroller's left edge, whose sticky label column is
 * `labelWidth` wide. Unclamped: it is negative left of the timeline's start.
 */
export function pointerToTimelineQ(
  pointerX: number,
  scrollLeft: number,
  labelWidth: number,
  quarterPx: number,
) {
  return (scrollLeft - labelWidth + pointerX) / quarterPx;
}

/**
 * Where media dropped at `pointerX` starts: the position under the pointer,
 * snapped like a clip move and never before 0. Over the label column it is 0.
 */
export function getDropStartQ(
  pointerX: number,
  scrollLeft: number,
  labelWidth: number,
  quarterPx: number,
  snapUnit: number,
  snap: boolean,
) {
  if (pointerX < labelWidth) {
    return 0;
  }

  return Math.max(
    0,
    snapQuarterValue(
      pointerToTimelineQ(pointerX, scrollLeft, labelWidth, quarterPx),
      snapUnit,
      snap,
    ),
  );
}

export function getClipDurationQ(
  clip: Pick<ArrangementClip | SourceSpan, "durationSeconds">,
  bpm: number,
) {
  return secondsToQuarters(clip.durationSeconds, bpm);
}

export function getClipEndQ(
  clip: Pick<ArrangementClip | SourceSpan, "startQ" | "durationSeconds">,
  bpm: number,
) {
  return clip.startQ + getClipDurationQ(clip, bpm);
}

export function resolveClipOverlapPreview(
  clips: ArrangementClip[],
  activeClipId: string,
  startQ: number,
  durationQ: number,
  bpm: number,
  laneId?: string,
) {
  const targetClip = clips.find((clip) => clip.id === activeClipId);
  if (!targetClip) {
    return clips;
  }

  const activeClip = withWindowTiming(
    targetClip,
    startQ,
    durationQ,
    bpm,
    laneId,
  );
  return resolveClipOverlaps(clips, activeClip, bpm);
}

export function findClosestTimelineLaneId(
  timelineScroll: HTMLElement,
  clientY: number,
  fallbackLaneId: string,
) {
  const laneElements = Array.from(
    timelineScroll.querySelectorAll<HTMLElement>("[data-timeline-lane-id]"),
  );

  if (!laneElements.length) {
    return fallbackLaneId;
  }

  for (const laneElement of laneElements) {
    const laneId = laneElement.dataset.timelineLaneId;
    if (!laneId) {
      continue;
    }

    const bounds = laneElement.getBoundingClientRect();
    if (clientY >= bounds.top && clientY <= bounds.bottom) {
      return laneId;
    }
  }

  let closestLaneId = fallbackLaneId;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const laneElement of laneElements) {
    const laneId = laneElement.dataset.timelineLaneId;
    if (!laneId) {
      continue;
    }

    const bounds = laneElement.getBoundingClientRect();
    const distance = Math.abs(clientY - (bounds.top + bounds.bottom) / 2);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestLaneId = laneId;
    }
  }

  return closestLaneId;
}

export function getSelectionEndQ(selection: TimelineSelection) {
  return selection.startQ + selection.durationQ;
}

export function getTimelineContentEndQ(
  clips: ArrangementClip[],
  sourceSpans: SourceSpan[],
  mainAudioDurationSeconds: number | undefined,
  bpm: number,
  barLength: number,
) {
  const clipTimelineEndQ = clips.reduce(
    (maximum, clip) => Math.max(maximum, getClipEndQ(clip, bpm)),
    0,
  );
  const sourceTimelineEndQ = sourceSpans.reduce(
    (maximum, span) => Math.max(maximum, getClipEndQ(span, bpm)),
    0,
  );
  const audioTimelineEndQ = mainAudioDurationSeconds
    ? secondsToQuarters(mainAudioDurationSeconds, bpm)
    : 0;

  return Math.max(
    barLength,
    clipTimelineEndQ,
    sourceTimelineEndQ,
    audioTimelineEndQ,
  );
}

export function getSourceTrackEndQ(
  sourceSpans: SourceSpan[],
  sourceTrackId: string,
  bpm: number,
) {
  return sourceSpans.reduce((maximum, span) => {
    if (span.sourceTrackId !== sourceTrackId) {
      return maximum;
    }

    return Math.max(maximum, getClipEndQ(span, bpm));
  }, 0);
}

export function isClipAtPlayhead(
  clip: ArrangementClip,
  playheadQ: number,
  bpm: number,
) {
  const epsilon = 0.0001;
  const clipEndQ = clip.startQ + secondsToQuarters(clip.durationSeconds, bpm);
  return playheadQ >= clip.startQ - epsilon && playheadQ < clipEndQ - epsilon;
}

export function findClipAtPlayhead(
  clips: ArrangementClip[],
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
) {
  let match: ArrangementClip | undefined;
  let matchLaneRank = -1;
  let matchStartQ = -1;

  for (const clip of clips) {
    if (!isClipAtPlayhead(clip, playheadQ, bpm)) {
      continue;
    }

    const laneRank = lanePriority.get(clip.laneId) ?? -1;
    if (
      laneRank > matchLaneRank ||
      (laneRank === matchLaneRank && clip.startQ > matchStartQ)
    ) {
      match = clip;
      matchLaneRank = laneRank;
      matchStartQ = clip.startQ;
    }
  }

  return match;
}

export function getPlaybackStopQ(
  clips: ArrangementClip[],
  mediaItems: MediaItem[],
  startQ: number,
  bpm: number,
) {
  const playableMediaIds = new Set(mediaItems.map((item) => item.id));

  return clips.reduce((maximum, clip) => {
    if (
      !isGeneratedClip(clip) &&
      (!clip.mediaId || !playableMediaIds.has(clip.mediaId))
    ) {
      return maximum;
    }

    const clipEndQ = getClipEndQ(clip, bpm);
    if (clipEndQ <= startQ) {
      return maximum;
    }

    return Math.max(maximum, clipEndQ);
  }, startQ);
}

export function chooseSourceSpanForWindow(
  spans: SourceSpan[],
  sourceTrackId: string,
  startQ: number,
  durationQ: number,
  bpm: number,
) {
  const endQ = startQ + durationQ;
  const sourceTrackSpans = spans.filter(
    (span) => span.sourceTrackId === sourceTrackId,
  );
  return (
    sourceTrackSpans.find((span) => {
      const spanEndQ = span.startQ + getClipDurationQ(span, bpm);
      return startQ >= span.startQ && startQ < spanEndQ;
    }) ??
    sourceTrackSpans.sort((left, right) => {
      const leftEnd = left.startQ + getClipDurationQ(left, bpm);
      const rightEnd = right.startQ + getClipDurationQ(right, bpm);
      const leftOverlap =
        Math.min(endQ, leftEnd) - Math.max(startQ, left.startQ);
      const rightOverlap =
        Math.min(endQ, rightEnd) - Math.max(startQ, right.startQ);
      return rightOverlap - leftOverlap;
    })[0]
  );
}
