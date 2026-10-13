// A MIDI clip's own timeline, as in Ableton Live: its notes live within its
// Length, a loop brace marks the region that repeats while its loop is on,
// and a Start marker, independent of the loop, sets where its first pass
// begins. The clip plays from Start to its loop end (or, with the loop off,
// its Length), then the loop region (or Start to Length) over and over until
// the clip ends. So Start 2.1.1 with a loop from 1.1.2 to 4.1.1 plays 2.1.1
// to 4.1.1 first, then 1.1.2 to 4.1.1 on every later pass.
import type { MidiNote } from "./midi-clip.ts";

/**
 * A MIDI clip's timeline, every value in quarter notes from its notes'
 * quarter 0: `length` ends its notes, `start` is its Start marker, and
 * `loopStart` and `loopEnd` its loop brace, which repeats when `loop` is on.
 */
export type MidiClipTimeline = {
  length: number;
  start: number;
  loopStart: number;
  loopEnd: number;
  loop: boolean;
};

export type MidiTimelineField = Exclude<keyof MidiClipTimeline, "loop">;

// The shortest Length and loop: a sixteenth note, the piano roll's grid.
export const MIDI_TIMELINE_MIN_Q = 0.25;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Where `timeline`'s passes end: its loop end, or its Length unlooped. */
export function midiTimelineEnd(timeline: MidiClipTimeline) {
  return timeline.loop ? timeline.loopEnd : timeline.length;
}

/**
 * `timeline` held together: Length at least the minimum, the loop brace
 * inside it and at least the minimum long, and Start before the end of the
 * first pass.
 */
export function normalizeMidiTimeline(
  timeline: MidiClipTimeline,
): MidiClipTimeline {
  const length = Math.max(MIDI_TIMELINE_MIN_Q, timeline.length);
  const loopEnd = clamp(timeline.loopEnd, MIDI_TIMELINE_MIN_Q, length);
  const loopStart = clamp(timeline.loopStart, 0, loopEnd - MIDI_TIMELINE_MIN_Q);
  const end = timeline.loop ? loopEnd : length;
  return {
    length,
    start: clamp(timeline.start, 0, end - MIDI_TIMELINE_MIN_Q),
    loopStart,
    loopEnd,
    loop: timeline.loop,
  };
}

/** A new MIDI clip's timeline: `lengthQ` long, looping all of it. */
export function newMidiTimeline(lengthQ: number): MidiClipTimeline {
  return normalizeMidiTimeline({
    length: lengthQ,
    start: 0,
    loopStart: 0,
    loopEnd: lengthQ,
    loop: true,
  });
}

/**
 * The timeline of a clip that has never set one: as long as its content,
 * from its notes' quarter 0 to the end of its window at `contentEndQ`, with
 * its loop off, so it plays its notes once just as they lie.
 */
export function defaultMidiTimeline(contentEndQ: number): MidiClipTimeline {
  return normalizeMidiTimeline({
    length: contentEndQ,
    start: 0,
    loopStart: 0,
    loopEnd: contentEndQ,
    loop: false,
  });
}

/**
 * A session clip's `midiTimeline` read from parsed JSON, held together.
 * Undefined when `value` is not an object or lacks a finite Length.
 */
export function readMidiTimeline(value: unknown): MidiClipTimeline | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (!isFiniteNumber(record.length)) {
    return undefined;
  }
  const number = (field: unknown, fallback: number) =>
    isFiniteNumber(field) ? field : fallback;
  return normalizeMidiTimeline({
    length: record.length,
    start: number(record.start, 0),
    loopStart: number(record.loopStart, 0),
    loopEnd: number(record.loopEnd, record.length),
    loop: record.loop === true,
  });
}

/**
 * `timeline` with `field` set to `valueQ`. Moving the loop end past the
 * Length lengthens the clip to it, as dragging the brace out does in Live;
 * everything else is held inside the Length.
 */
export function setMidiTimelineField(
  timeline: MidiClipTimeline,
  field: MidiTimelineField,
  valueQ: number,
): MidiClipTimeline {
  const next = { ...timeline, [field]: Math.max(0, valueQ) };
  if (field === "loopEnd") {
    next.loopEnd = Math.max(
      next.loopEnd,
      timeline.loopStart + MIDI_TIMELINE_MIN_Q,
    );
    next.length = Math.max(timeline.length, next.loopEnd);
  }
  return normalizeMidiTimeline(next);
}

/**
 * `timeline` with its loop brace moved by `deltaQ`, kept at or after
 * quarter 0 and lengthening the clip when it moves past the Length.
 */
export function moveMidiLoop(
  timeline: MidiClipTimeline,
  deltaQ: number,
): MidiClipTimeline {
  const shift = Math.max(-timeline.loopStart, deltaQ);
  const loopEnd = timeline.loopEnd + shift;
  return normalizeMidiTimeline({
    ...timeline,
    length: Math.max(timeline.length, loopEnd),
    loopStart: timeline.loopStart + shift,
    loopEnd,
  });
}

/** What a drag on the piano roll's ruler moves: a marker or the brace. */
export type MidiTimelineHandle = MidiTimelineField | "loop";

/**
 * `from` with `handle` dragged `deltaQ` quarters, landing on the piano
 * roll's sixteenth-note grid.
 */
export function dragMidiTimeline(
  from: MidiClipTimeline,
  handle: MidiTimelineHandle,
  deltaQ: number,
): MidiClipTimeline {
  const snap = (valueQ: number) =>
    Math.round(valueQ / MIDI_TIMELINE_MIN_Q) * MIDI_TIMELINE_MIN_Q;
  return handle === "loop"
    ? moveMidiLoop(from, snap(deltaQ))
    : setMidiTimelineField(from, handle, snap(from[handle] + deltaQ));
}

/** `timeline` with its loop turned on or off. */
export function setMidiTimelineLoop(
  timeline: MidiClipTimeline,
  loop: boolean,
): MidiClipTimeline {
  return normalizeMidiTimeline({ ...timeline, loop });
}

/** Whether two timelines are the same. */
export function sameMidiTimeline(
  left: MidiClipTimeline,
  right: MidiClipTimeline,
) {
  return (
    left.length === right.length &&
    left.start === right.start &&
    left.loopStart === right.loopStart &&
    left.loopEnd === right.loopEnd &&
    left.loop === right.loop
  );
}

/**
 * The notes the clip plays, in quarters from its content start, up to
 * `untilQ`: the first pass from Start to the end, then the repeating region
 * after it. A note plays in a pass when it starts inside the pass's region
 * and is cut at the region's end. Without a timeline, the clip plays
 * `notes` as they lie.
 */
export function performMidiNotes(
  notes: readonly MidiNote[],
  timeline: MidiClipTimeline | undefined,
  untilQ: number,
): readonly MidiNote[] {
  if (!timeline) {
    return notes;
  }
  const end = midiTimelineEnd(timeline);
  const repeatStart = timeline.loop ? timeline.loopStart : timeline.start;
  const played: MidiNote[] = [];
  const playPass = (from: number, offset: number) => {
    for (const note of notes) {
      const at = offset + note.start - from;
      if (note.start >= from && note.start < end && at < untilQ) {
        played.push({
          ...note,
          start: at,
          length: Math.min(note.length, end - note.start),
        });
      }
    }
  };
  playPass(timeline.start, 0);
  const passLength = end - repeatStart;
  for (
    let offset = end - timeline.start;
    offset < untilQ && passLength > 0;
    offset += passLength
  ) {
    playPass(repeatStart, offset);
  }
  return played;
}
