import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AuditionVoice } from "../../midi-audition.ts";
import type { ExpressionSample, MidiNote } from "../../midi-clip.ts";
import type { MidiInputHub } from "../../midi-input/input-hub.ts";
import { midiKeyEvent } from "../../midi-input/keyboard-layout.ts";
import { mpeInputFor } from "../../midi-input/mpe.ts";
import {
  type CaptureClip,
  captureNote,
  createExpressionRecorder,
  type ExpressionRecorder,
  type HeldNote,
  pressNote,
} from "../../midi-input/note-capture.ts";
import type { FxModulationClock } from "../fx/modulation-clock";

const NOT_HELD: readonly HeldNote[] = [];

// A key that is down, as its device's expression reaches it.
type PressedKey = {
  inputId: string;
  channel: number;
  pressedAtQ: number;
  recorder: ExpressionRecorder;
  voice: AuditionVoice | undefined;
};

// Plays the piano roll from MIDI keys while `enabled`: every key auditions
// its pitch, and while the transport plays inside `clip` it also writes a
// note, handed to `onCapture` when the key comes up. The transport stopping
// or the playhead jumping back ends the held notes where the playhead was,
// and so does the device going away or the roll closing. Returns the notes
// held so far and the connected inputs. A device playing MPE (see
// midi-input/mpe.ts) shapes each key's audition and note by its own channel,
// and holds the audition until the key comes up, the device goes away or the
// roll closes. Once a device is shown to play MPE, so do the keys it has down.
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
  onAudition: (
    pitch: number,
    expression: ExpressionSample | undefined,
    hold: boolean,
  ) => AuditionVoice | undefined;
  onCapture: (note: MidiNote) => void;
}) {
  const [heldNotes, setHeldNotes] = useState(NOT_HELD);
  const inputs = useSyncExternalStore(hub.subscribeInputs, hub.getInputs);
  const latest = useRef({ clip, clock, onAudition, onCapture });
  latest.current = { clip, clock, onAudition, onCapture };
  const signal = clock?.signal;
  const isPlaying = Boolean(clock?.isPlaying);
  const held = useRef(new Map<string, HeldNote>());
  const pressed = useRef(new Map<string, PressedKey>());
  // Where the playhead last was, which is where held notes end if it jumps.
  const lastQ = useRef(signal?.get() ?? 0);

  const finish = useCallback(
    (key: string, playheadQ: number) => {
      const note = held.current.get(key);
      const press = pressed.current.get(key);
      if (note) {
        held.current.delete(key);
        setHeldNotes([...held.current.values()]);
        const keepExpression =
          press && mpeInputFor(hub, press.inputId).isActive();
        latest.current.onCapture(
          captureNote(
            latest.current.clip,
            note,
            playheadQ,
            keepExpression ? press.recorder : undefined,
          ),
        );
      }
    },
    [hub],
  );
  const finishAll = useCallback(
    (playheadQ: number) => {
      for (const key of [...held.current.keys()]) {
        finish(key, playheadQ);
      }
    },
    [finish],
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const holdPressedKeys = (inputId: string) => {
      const mpe = mpeInputFor(hub, inputId);
      for (const press of pressed.current.values()) {
        if (press.inputId === inputId) {
          press.voice?.hold();
          const sample = mpe.sampleOf(press.channel);
          if (sample) {
            press.voice?.update(sample);
          }
        }
      }
    };
    const stopListening = hub.listen({
      message(input, message) {
        const mpe = mpeInputFor(hub, input.id);
        const { clip, clock, onAudition } = latest.current;
        const playheadQ = clock?.signal.get() ?? lastQ.current;
        const key = midiKeyEvent(message, input.mapping);
        if (!key) {
          if (message.type !== "note-on" && message.type !== "note-off") {
            const wasActive = mpe.isActive();
            mpe.receive(message);
            if (!wasActive && mpe.isActive()) {
              holdPressedKeys(input.id);
            }
            for (const press of pressed.current.values()) {
              const sample =
                press.inputId === input.id && mpe.sampleOf(press.channel);
              if (sample) {
                press.recorder.add(playheadQ - press.pressedAtQ, sample);
                if (mpe.isActive()) {
                  press.voice?.update(sample);
                }
              }
            }
          }
          return;
        }
        const heldKey = `${input.id}:${key.channel}:${key.pitch}`;
        if (!key.down) {
          finish(heldKey, playheadQ);
          pressed.current.get(heldKey)?.voice?.release();
          pressed.current.delete(heldKey);
          mpe.released(key.channel, key.pitch);
          return;
        }
        finish(heldKey, playheadQ);
        pressed.current.get(heldKey)?.voice?.release();
        pressed.current.delete(heldKey);
        const wasActive = mpe.isActive();
        mpe.pressed(key.channel, key.pitch);
        if (!wasActive && mpe.isActive()) {
          holdPressedKeys(input.id);
        }
        const sample = mpe.sampleOf(key.channel);
        const voice = mpe.isActive()
          ? onAudition(key.pitch, sample, true)
          : onAudition(key.pitch, undefined, false);
        const recorder = createExpressionRecorder();
        if (sample) {
          recorder.add(0, sample);
        }
        pressed.current.set(heldKey, {
          inputId: input.id,
          channel: key.channel,
          pressedAtQ: playheadQ,
          recorder,
          voice,
        });
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
        for (const [key, press] of [...pressed.current]) {
          if (press.inputId === input.id) {
            press.voice?.release();
            pressed.current.delete(key);
          }
        }
        mpeInputFor(hub, input.id).releaseAll();
      },
    });
    return () => {
      stopListening();
      finishAll(lastQ.current);
      // The hub no longer tells this listener about keys coming up.
      for (const { inputId, voice } of pressed.current.values()) {
        voice?.release();
        mpeInputFor(hub, inputId).releaseAll();
      }
      pressed.current.clear();
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
