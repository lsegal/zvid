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
// and so does the device going away, MIDI turning off or the roll closing.
// The hub decides which ports play. Returns the notes held so far, the hub's
// state, and `press` and `release` for playing keys from elsewhere.
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
  const midi = useSyncExternalStore(hub.subscribe, hub.getState);
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
  // Each key has its own `heldKey`, so a press ends its last note, if any.
  const press = useRef((heldKey: string, pitch: number, velocity: number) => {
    const { clip, clock, onAudition } = latest.current;
    const playheadQ = clock?.signal.get() ?? lastQ.current;
    onAudition(pitch);
    finish(heldKey, playheadQ);
    if (clock?.isPlaying) {
      const note = pressNote(clip, pitch, velocity, playheadQ);
      if (note) {
        held.current.set(heldKey, note);
        setHeldNotes([...held.current.values()]);
      }
    }
  }).current;
  const release = useRef((heldKey: string) => {
    finish(heldKey, latest.current.clock?.signal.get() ?? lastQ.current);
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
        if (key.down) {
          press(heldKey, key.pitch, key.velocity);
        } else {
          release(heldKey);
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
  }, [enabled, hub, finish, finishAll, press, release]);

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

  return { heldNotes, midi, press, release };
}
