// The standard keyboard layout, the one every device plays through: a Note
// On or Note Off's note number is the pitch (the numbering `pitchName` names)
// and its velocity is the note's. A device's mapping only takes away: notes
// its mapping says come from a button or the like aren't keys.
import {
  PIANO_ROLL_HIGH_PITCH,
  PIANO_ROLL_LOW_PITCH,
} from "../midi-piano-roll.ts";
import {
  controlForMessage,
  type MidiDeviceMapping,
} from "./device-mappings.ts";
import type { MidiMessage } from "./messages.ts";

export type MidiKeyEvent =
  | { down: true; channel: number; pitch: number; velocity: number }
  | { down: false; channel: number; pitch: number };

/**
 * The key `message` presses or releases under the standard layout, if any:
 * notes outside the piano roll's keys are ignored rather than clamped.
 */
export function standardKeyEvent(
  message: MidiMessage,
): MidiKeyEvent | undefined {
  if (message.type !== "note-on" && message.type !== "note-off") {
    return undefined;
  }
  const { channel, note: pitch } = message;
  if (pitch < PIANO_ROLL_LOW_PITCH || pitch > PIANO_ROLL_HIGH_PITCH) {
    return undefined;
  }
  return message.type === "note-on"
    ? { down: true, channel, pitch, velocity: message.velocity }
    : { down: false, channel, pitch };
}

/**
 * The key `message` from a device mapped by `mapping` presses or releases.
 * Only keys and pads act; a control of any other kind does nothing, and a
 * note its mapping doesn't list plays through the standard layout.
 */
export function midiKeyEvent(
  message: MidiMessage,
  mapping: MidiDeviceMapping | undefined,
): MidiKeyEvent | undefined {
  const control = mapping && controlForMessage(mapping, message);
  return control && control.kind !== "key" && control.kind !== "pad"
    ? undefined
    : standardKeyEvent(message);
}
