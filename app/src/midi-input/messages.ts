// MIDI's channel messages as the app reads them, from the bytes Web MIDI
// delivers: a whole message per event, so no running status to undo.

export type MidiMessage =
  | { type: "note-on"; channel: number; note: number; velocity: number }
  | { type: "note-off"; channel: number; note: number }
  | { type: "cc"; channel: number; controller: number; value: number }
  | { type: "pitchbend"; channel: number; value: number }
  | { type: "pressure"; channel: number; value: number }
  | { type: "program"; channel: number; value: number };

/**
 * The message in `data`, its `channel` from 1 to 16. Undefined for anything
 * else: System messages (clock and active sensing arrive constantly), and
 * polyphonic pressure, which no control is mapped to.
 */
export function parseMidiMessage(
  data: ArrayLike<number>,
): MidiMessage | undefined {
  const status = data[0] ?? 0;
  const channel = (status & 0x0f) + 1;
  const first = data[1] ?? 0;
  const second = data[2] ?? 0;
  switch (status & 0xf0) {
    case 0x80:
      return data.length < 3 ? undefined : { type: "note-off", channel, note: first };
    case 0x90:
      if (data.length < 3) {
        return undefined;
      }
      // A Note On at velocity 0 is a Note Off.
      return second === 0
        ? { type: "note-off", channel, note: first }
        : { type: "note-on", channel, note: first, velocity: second };
    case 0xb0:
      return data.length < 3 ? undefined : { type: "cc", channel, controller: first, value: second };
    case 0xc0:
      return data.length < 2 ? undefined : { type: "program", channel, value: first };
    case 0xd0:
      return data.length < 2 ? undefined : { type: "pressure", channel, value: first };
    case 0xe0:
      // Fourteen bits, least significant byte first.
      return data.length < 3 ? undefined : { type: "pitchbend", channel, value: (second << 7) | first };
    default:
      return undefined;
  }
}
