// The notes of a MIDI recording pass as they're played, which every armed
// track records. Quantizing happens as each note lands, so the growing clip
// shows them where they'll stay. The clip starts on the quantize grid, at or
// before the playhead, so that a note snapping back lands on the grid too.
import { quartersToSeconds } from "../app/timeline-math.ts";
import type { MidiNote } from "../midi-clip.ts";
import { newMidiTimeline } from "../midi-clip-timeline.ts";
import type { CaptureClip, HeldNote } from "../midi-input/note-capture.ts";
import { CAPTURED_NOTE_MIN_LENGTH_Q } from "../midi-input/note-capture.ts";
import { placeNote } from "../midi-piano-roll.ts";
import {
  quantizeFloorQ,
  quantizeQ,
  type RecordQuantize,
} from "./midi-quantize.ts";
import type { RecordMidiInput } from "./record-source.ts";

// Longer than any pass, so a note never reaches the end of its capture clip.
const CAPTURE_LENGTH_Q = 1_000_000;

const NO_NOTES: readonly MidiNote[] = [];

export type MidiTakeOptions = {
  startQ: number;
  input: RecordMidiInput;
  quantize: RecordQuantize;
  playheadQ: () => number;
  bpm: () => number;
};

export class MidiTake {
  readonly input: RecordMidiInput;
  readonly clipStartQ: number;
  // What note capture plays against: a window as long as the pass.
  readonly captureClip: CaptureClip;
  private readonly quantize: RecordQuantize;
  private readonly playheadQ: () => number;
  private readonly bpm: () => number;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private notes: readonly MidiNote[] = NO_NOTES;
  private held: readonly HeldNote[] = [];
  private reachedQ: number;
  private flushHeld: (() => void) | undefined;

  constructor({ startQ, input, quantize, playheadQ, bpm }: MidiTakeOptions) {
    this.input = input;
    this.quantize = quantize;
    this.playheadQ = playheadQ;
    this.bpm = bpm;
    this.clipStartQ = quantizeFloorQ(startQ, quantize);
    this.reachedQ = startQ;
    this.captureClip = {
      startQ: this.clipStartQ,
      trimStartQ: 0,
      lengthQ: CAPTURE_LENGTH_Q,
      timeline: newMidiTimeline(CAPTURE_LENGTH_Q),
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Changes whenever the notes to draw do, other than with the playhead. */
  getVersion = () => this.version;

  private publish() {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private snappedStart(start: number) {
    return Math.max(
      0,
      quantizeQ(this.clipStartQ + start, this.quantize) - this.clipStartQ,
    );
  }

  /** A note whose key came up, placed over what it lands on. */
  addNote(note: MidiNote) {
    const placed = { ...note, start: this.snappedStart(note.start) };
    this.notes = placeNote([...this.notes, placed], this.notes.length);
    this.publish();
  }

  setHeld(held: readonly HeldNote[]) {
    this.held = held;
    this.publish();
  }

  /** How capture ends the keys still down when the pass stops. */
  setFlushHeld(flush: (() => void) | undefined) {
    this.flushHeld = flush;
  }

  /** The notes to draw: finished ones and the held ones, up to the playhead. */
  shownNotes(): readonly MidiNote[] {
    if (!this.held.length) {
      return this.notes;
    }
    const playheadQ = this.playheadQ();
    return [
      ...this.notes,
      ...this.held.map((held) => ({
        pitch: held.pitch,
        start: this.snappedStart(held.startQ),
        length: Math.max(
          CAPTURED_NOTE_MIN_LENGTH_Q,
          playheadQ - held.pressedAtQ,
        ),
        velocity: held.velocity,
      })),
    ];
  }

  /** How far the clip has grown, following the playhead and never shrinking. */
  elapsedSeconds() {
    this.reachedQ = Math.max(this.reachedQ, this.playheadQ());
    return quartersToSeconds(this.reachedQ - this.clipStartQ, this.bpm());
  }

  /** Nothing to release; capture stops along with the pass. */
  async stop() {
    return [];
  }

  /** Ends held keys, and returns the clip's notes and how long it runs. */
  finish() {
    this.flushHeld?.();
    this.elapsedSeconds();
    const lastEndQ = Math.max(
      0,
      ...this.notes.map((note) => note.start + note.length),
    );
    return {
      notes: this.notes,
      durationQ: Math.max(this.reachedQ - this.clipStartQ, lastEndQ),
    };
  }
}
