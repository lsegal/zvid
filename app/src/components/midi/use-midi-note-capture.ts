import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MidiNote } from "../../midi-clip.ts";
import type { MidiInputHub } from "../../midi-input/input-hub.ts";
import { midiKeyEvent } from "../../midi-input/keyboard-layout.ts";
import {
  type CaptureClip,
  captureNote,
  type HeldNote,
  pressNote,
} from "../../midi-input/note-capture.ts";
import type { FxModulationClock } from "../fx/modulation-clock";

const NOT_HELD: readonly HeldNote[] = [];

// Plays the piano roll from MIDI keys while `enabled`: every key auditions
// its pitch, and while the transport plays inside `clip` it also writes a
// note, handed to `onCapture` when the key comes up. The transport stopping
// or the playhead jumping back ends the held notes where the playhead was,
// and so does the device going away or the roll closing. Returns the notes
// held so far and the connected inputs.
export function useMidiNoteCapture({
  enabled,
  hub,
  clip,
  clock,
  onAudition,
  onCapture,
}: {
  enabled: boolean;
  hub: MidiInputHub;
  clip: CaptureClip;
  clock: FxModulationClock | null;
  onAudition: (pitch: number) => void;
  onCapture: (note: MidiNote) => void;
}) {
  const [heldNotes, setHeldNotes] = useState(NOT_HELD);
  const inputs = useSyncExternalStore(hub.subscribeInputs, hub.getInputs);
  const latest = useRef({ clip, clock, onAudition, onCapture });
  latest.current = { clip, clock, onAudition, onCapture };
  const signal = clock?.signal;
  const isPlaying = Boolean(clock?.isPlaying);
  const held = useRef(new Map<string, HeldNote>());
  // Where the playhead last was, which is where held notes end if it jumps.
  const lastQ = useRef(signal?.get() ?? 0);

  const finish = useRef((key: string, playheadQ: number) => {
    const note = held.current.get(key);
    if (note) {
      held.current.delete(key);
      setHeldNotes([...held.current.values()]);
      latest.current.onCapture(
        captureNote(latest.current.clip, note, playheadQ),
      );
    }
  }).current;
  const finishAll = useRef((playheadQ: number) => {
    for (const key of [...held.current.keys()]) {
      finish(key, playheadQ);
    }
  }).current;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const stopListening = hub.listen({
      message(input, message) {
        const key = midiKeyEvent(message, input.mapping);
        if (!key) {
          return;
        }
        const heldKey = `${input.id}:${key.channel}:${key.pitch}`;
        const { clip, clock, onAudition } = latest.current;
        const playheadQ = clock?.signal.get() ?? lastQ.current;
        if (!key.down) {
          finish(heldKey, playheadQ);
          return;
        }
        onAudition(key.pitch);
        finish(heldKey, playheadQ);
        if (clock?.isPlaying) {
          const note = pressNote(clip, key.pitch, key.velocity, playheadQ);
          if (note) {
            held.current.set(heldKey, note);
            setHeldNotes([...held.current.values()]);
          }
        }
      },
      disconnected(input) {
        for (const key of [...held.current.keys()]) {
          if (key.startsWith(`${input.id}:`)) {
            finish(key, lastQ.current);
          }
        }
      },
    });
    return () => {
      stopListening();
      finishAll(lastQ.current);
    };
  }, [enabled, hub, finish, finishAll]);

  useEffect(() => {
    if (!signal) {
      return undefined;
    }
    lastQ.current = signal.get();
    return signal.subscribe(() => {
      const next = signal.get();
      if (next < lastQ.current) {
        finishAll(lastQ.current);
      }
      lastQ.current = next;
    });
  }, [signal, finishAll]);

  useEffect(() => {
    if (!isPlaying) {
      finishAll(lastQ.current);
    }
  }, [isPlaying, finishAll]);

  return { heldNotes, inputs };
}
