// Turns MIDI keys into notes against the running playhead: a note starts at
// the note quarter sounding when its key went down and lasts until the key
// comes up.
import type { MidiNote } from "../midi-clip.ts";
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
): MidiNote {
  return {
    pitch: held.pitch,
    start: resolution(held.startQ),
    length: Math.max(
      CAPTURED_NOTE_MIN_LENGTH_Q,
      resolution(heldNoteLength(clip, held, playheadQ)),
    ),
    velocity: held.velocity,
  };
}
