// Turns MIDI keys into notes against the running playhead: a note starts at
// the note quarter sounding when its key went down and lasts until the key
// comes up.
import { TIMBRE_CENTER } from "../audio-mix/note-expression.ts";
import type {
  ExpressionPoint,
  ExpressionSample,
  MidiNote,
  NoteExpression,
} from "../midi-clip.ts";
import {
  type MidiClipTimeline,
  midiSoundingQ,
  midiTimelineEnd,
} from "../midi-clip-timeline.ts";

// Keeps a captured note's numbers tidy without audibly moving it.
const CAPTURE_RESOLUTION_PER_Q = 960;
// A tap as short as this still leaves a note that can be seen and grabbed.
export const CAPTURED_NOTE_MIN_LENGTH_Q = 1 / 16;

export type CaptureClip = {
  startQ: number;
  trimStartQ: number;
  lengthQ: number;
  timeline: MidiClipTimeline;
};

// How finely a curve's values are kept, and how close its points may sit.
const EXPRESSION_VALUE_PRECISION = 1000;
const EXPRESSION_MIN_SPACING_Q = 1 / 96;
const ROUNDED_TIMBRE_CENTER =
  Math.round(TIMBRE_CENTER * EXPRESSION_VALUE_PRECISION) /
  EXPRESSION_VALUE_PRECISION;

/** A key being held: where its note started, on the clip and the timeline. */
export type HeldNote = {
  pitch: number;
  velocity: number;
  startQ: number;
  pressedAtQ: number;
};

function resolution(valueQ: number) {
  return (
    Math.round(valueQ * CAPTURE_RESOLUTION_PER_Q) / CAPTURE_RESOLUTION_PER_Q
  );
}

/**
 * The note quarter (from the clip's content start) `clip` sounds at timeline
 * quarter `playheadQ`, or undefined outside the clip.
 */
export function clipSoundingQ(
  { startQ, trimStartQ, lengthQ, timeline }: CaptureClip,
  playheadQ: number,
) {
  const intoClipQ = playheadQ - startQ;
  return intoClipQ >= 0 && intoClipQ < lengthQ
    ? midiSoundingQ(timeline, trimStartQ + intoClipQ)
    : undefined;
}

/** The note a key pressed at `playheadQ` starts, if the clip is sounding. */
export function pressNote(
  clip: CaptureClip,
  pitch: number,
  velocity: number,
  playheadQ: number,
): HeldNote | undefined {
  const startQ = clipSoundingQ(clip, playheadQ);
  return startQ === undefined
    ? undefined
    : { pitch, velocity, startQ, pressedAtQ: playheadQ };
}

/**
 * How long `held` has sounded at `playheadQ`, stopping where the clip ends
 * or its pass does: past those the playhead is elsewhere in the clip's notes.
 */
export function heldNoteLength(
  clip: CaptureClip,
  held: HeldNote,
  playheadQ: number,
) {
  return Math.max(
    0,
    Math.min(
      playheadQ - held.pressedAtQ,
      clip.startQ + clip.lengthQ - held.pressedAtQ,
      midiTimelineEnd(clip.timeline) - held.startQ,
    ),
  );
}

/** The note `held` leaves when its key comes up at `playheadQ`. */
export function captureNote(
  clip: CaptureClip,
  held: HeldNote,
  playheadQ: number,
  expression?: ExpressionRecorder,
): MidiNote {
  const heldLength = resolution(heldNoteLength(clip, held, playheadQ));
  const recorded = expression?.expression(heldLength);
  return {
    pitch: held.pitch,
    start: resolution(held.startQ),
    length: Math.max(CAPTURED_NOTE_MIN_LENGTH_Q, heldLength),
    velocity: held.velocity,
    ...(recorded ? { expression: recorded } : {}),
  };
}

/** Collects what a held note does, for the note it leaves. */
export type ExpressionRecorder = {
  /** What the note's channel says `atQ` quarter notes after it was pressed. */
  add: (atQ: number, sample: ExpressionSample) => void;
  /** The expression of a note `lengthQ` long; undefined if it has none. */
  expression: (lengthQ: number) => NoteExpression | undefined;
};

function addPoint(curve: ExpressionPoint[], atQ: number, raw: number) {
  const value =
    Math.round(raw * EXPRESSION_VALUE_PRECISION) / EXPRESSION_VALUE_PRECISION;
  const last = curve[curve.length - 1];
  if (!last) {
    curve.push({ at: 0, value });
  } else if (last.value === value) {
    return;
  } else if (last.at > 0 && atQ - last.at < EXPRESSION_MIN_SPACING_Q) {
    // A device sends far more often than can be heard or is worth saving.
    last.value = value;
  } else {
    curve.push({ at: resolution(Math.max(last.at, atQ)), value });
  }
}

// `curve` up to `lengthQ`, or undefined if its note may as well not have it.
function finishedCurve(
  curve: readonly ExpressionPoint[],
  lengthQ: number,
  neutral: number,
) {
  const kept = curve.filter((point) => point.at <= lengthQ);
  return kept.some((point) => point.value !== neutral) ? kept : undefined;
}

export function createExpressionRecorder(): ExpressionRecorder {
  const bend: ExpressionPoint[] = [];
  const pressure: ExpressionPoint[] = [];
  const timbre: ExpressionPoint[] = [];
  return {
    add(atQ, sample) {
      addPoint(bend, atQ, sample.bend);
      if (sample.pressure !== undefined) {
        addPoint(pressure, atQ, sample.pressure);
      }
      if (sample.timbre !== undefined) {
        addPoint(timbre, atQ, sample.timbre);
      }
    },
    expression(lengthQ) {
      const curves = {
        bend: finishedCurve(bend, lengthQ, 0),
        // A device with no pressure to give sends 0 and means nothing by it.
        pressure: finishedCurve(pressure, lengthQ, 0),
        timbre: finishedCurve(timbre, lengthQ, ROUNDED_TIMBRE_CENTER),
      };
      const entries = Object.entries(curves).filter(([, curve]) => curve);
      return entries.length ? Object.fromEntries(entries) : undefined;
    },
  };
}
