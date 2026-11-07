import { useEffect, useMemo } from "react";
import { computerKeyboardEntry } from "../../midi-input/computer-keyboard.ts";
import { midiInputHub } from "../../midi-input/input-hub.ts";
import type { PlayheadSignal } from "../../playhead-signal.ts";
import { auditionArmedTracks } from "../../recording/armed-audition.ts";
import type { MidiTake } from "../../recording/midi-take.ts";
import { useComputerKeyboardEntry } from "../midi/use-computer-keyboard-entry";
import { useMidiNoteCapture } from "../midi/use-midi-note-capture";

// Plays a MIDI pass's notes into its take, from the chosen input: the keys of
// the MIDI device or the typing keyboard, each auditioning through the armed
// tracks' instruments. Stays out of the app's render while notes play.
export function MidiTakeCapture({
  take,
  playheadSignal,
  isPlaying,
}: {
  take: MidiTake;
  playheadSignal: PlayheadSignal;
  isPlaying: boolean;
}) {
  const clock = useMemo(
    () => ({ signal: playheadSignal, isPlaying }),
    [playheadSignal, isPlaying],
  );
  const { heldNotes, playKey, releaseKey, finishHeld } = useMidiNoteCapture({
    enabled: take.input === "device",
    hub: midiInputHub,
    clip: take.captureClip,
    clock,
    onAudition: (pitch, velocity, expression) =>
      auditionArmedTracks(pitch, expression, undefined, velocity),
    onCapture: (note) => take.addNote(note),
  });
  useComputerKeyboardEntry({
    active: take.input === "keyboard",
    entry: computerKeyboardEntry,
    press: playKey,
    release: releaseKey,
  });
  useEffect(() => {
    take.setHeld(heldNotes);
  }, [take, heldNotes]);
  useEffect(() => {
    take.setFlushHeld(() => finishHeld(playheadSignal.get()));
    return () => take.setFlushHeld(undefined);
  }, [take, finishHeld, playheadSignal]);
  return null;
}
