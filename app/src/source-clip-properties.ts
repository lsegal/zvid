// The Source Clip Properties row: a selected source clip's Start, Length and
// Offset as time values in quarter notes, the range each may take, and the
// source spans once one of them is edited.
//
// Start and Length place the clip like a move or trim on the timeline, so
// they resolve overlaps in its source track the same way. Offset only changes
// where in its media the clip plays from, so it never moves another clip.
import { quartersToSeconds, secondsToQuarters } from "./app/timeline-math.ts";
import type { SourceSpan } from "./app/types.ts";
import type { MediaItem } from "./media";
import {
  getSourceSpanMaxSeconds,
  resolveSourceSpanOverlaps,
} from "./source-span-edit.ts";
import type { TimeValueRange } from "./time-value.ts";

export type SourceClipField = "start" | "length" | "offset";

export const SOURCE_CLIP_FIELDS: readonly SourceClipField[] = [
  "start",
  "length",
  "offset",
];

export const SOURCE_CLIP_FIELD_LABELS: Record<SourceClipField, string> = {
  start: "Start",
  length: "Length",
  offset: "Offset",
};

export const SOURCE_CLIP_HISTORY_LABELS: Record<SourceClipField, string> = {
  start: "Set source clip start",
  length: "Set source clip length",
  offset: "Set source clip offset",
};

export type SourceClipLimits = Record<SourceClipField, TimeValueRange>;

export function getSourceClipPanelTitle(
  clipLabel: string,
  trackName: string | undefined,
) {
  const name = clipLabel.trim() || "Untitled";
  return trackName
    ? `Source Clip Properties: ${name} (${trackName})`
    : `Source Clip Properties: ${name}`;
}

/**
 * The media length the clip's fields are limited to, in seconds: 0 while the
 * media is offline, still loading or of unknown length, so the limits fall
 * back to the clip's current values.
 */
export function getKnownMediaDurationSeconds(media: MediaItem | undefined) {
  return media?.availability === "ready" && media.durationSeconds > 0
    ? media.durationSeconds
    : 0;
}

/** The clip's Start, Length and Offset, in quarter notes. */
export function getSourceClipValues(
  span: SourceSpan,
  bpm: number,
): Record<SourceClipField, number> {
  return {
    start: span.startQ,
    length: secondsToQuarters(span.durationSeconds, bpm),
    offset: secondsToQuarters(span.trimStartSeconds, bpm),
  };
}

/**
 * The range each field may take, in quarter notes. Start runs from 0 to the
 * end of the timeline. Length lasts at least one frame and Offset starts at
 * 0, and together they never play past the end of the media. While the
 * media's length is not known, Length and Offset can't grow past their
 * current values.
 */
export function getSourceClipLimits(
  span: SourceSpan,
  {
    bpm,
    fps,
    timelineLengthQ,
    mediaDurationSeconds,
  }: {
    bpm: number;
    fps: number;
    timelineLengthQ: number;
    mediaDurationSeconds: number;
  },
): SourceClipLimits {
  const values = getSourceClipValues(span, bpm);
  const frameQ = secondsToQuarters(1 / fps, bpm);
  const known = mediaDurationSeconds > 0;
  const lengthMaxQ = known
    ? secondsToQuarters(
        getSourceSpanMaxSeconds(span, mediaDurationSeconds, bpm),
        bpm,
      )
    : values.length;
  const offsetMaxQ = known
    ? secondsToQuarters(mediaDurationSeconds - span.durationSeconds, bpm)
    : values.offset;

  return {
    start: { min: 0, max: Math.max(values.start, timelineLengthQ) },
    length: { min: frameQ, max: Math.max(frameQ, lengthMaxQ) },
    offset: { min: 0, max: Math.max(0, offsetMaxQ) },
  };
}

/** `span` with `field` set to `valueQ` quarter notes. */
export function setSourceClipField(
  span: SourceSpan,
  field: SourceClipField,
  valueQ: number,
  bpm: number,
): SourceSpan {
  switch (field) {
    case "start":
      return { ...span, startQ: valueQ };
    case "length":
      return { ...span, durationSeconds: quartersToSeconds(valueQ, bpm) };
    case "offset":
      return { ...span, trimStartSeconds: quartersToSeconds(valueQ, bpm) };
  }
}

/**
 * The source spans once `field` of span `spanId` is set to `valueQ`. Start
 * and Length trim the spans the clip now overlaps in its source track, as a
 * move or trim on the timeline does. Returns `spans` when nothing changes.
 */
export function editSourceClipField(
  spans: SourceSpan[],
  spanId: string,
  field: SourceClipField,
  valueQ: number,
  bpm: number,
): SourceSpan[] {
  const span = spans.find((candidate) => candidate.id === spanId);
  if (!span || getSourceClipValues(span, bpm)[field] === valueQ) {
    return spans;
  }

  const edited = setSourceClipField(span, field, valueQ, bpm);
  return field === "offset"
    ? spans.map((candidate) => (candidate.id === spanId ? edited : candidate))
    : resolveSourceSpanOverlaps(spans, edited, bpm);
}
