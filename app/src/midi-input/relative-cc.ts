// Relative encoders on controls nothing says are relative (#1644): a device
// that isn't listed, an encoder its entry reads as absolute, or one set to a
// relative mode. Read as absolute, one step up sends 1 and one down 127, which
// slam a target between the ends of its range. So a CC that no entry calls
// relative is read from its first messages, as Ableton Live's MIDI map does:
//
// - A value no small step writes, such as 0, 64 or anything mid-range, is a
//   position, and so is a run of values with nothing a relative encoder shows.
// - The same step twice running, or a step up next to a step down, is an
//   encoder: a knob or fader moving sends a new position each time.
//
// Until it's known, a control's messages are held, not applied, so that neither
// reading moves its target the wrong way. Once known, what was held is applied
// as that reading would: all the steps, or the last position.
import type { DeviceControlMove } from "./device-controls.ts";
import type { MidiMessage } from "./messages.ts";

type CcMessage = Extract<MidiMessage, { type: "cc" }>;

// The most steps one message is taken to send while a control is unknown: an
// encoder's first messages are slow ones, and a wider band makes more of a
// knob's range wait at either end.
const SMALL_STEPS = 8;
// Values held with no sign of an encoder before they're read as positions.
const HELD_POSITIONS = 3;

// How far a relative value steps: below 64 that many up, and otherwise down in
// two's complement (127 is one down) or sign and magnitude (65 is one down),
// told apart by which half of the range they fall in.
export function relativeSteps(value: number) {
  if (value < 64) {
    return value;
  }
  return value >= 96 ? value - 128 : 64 - value;
}

function isSmallStep(value: number) {
  return (
    (value >= 1 && value <= SMALL_STEPS) ||
    (value > 64 && value <= 64 + SMALL_STEPS) ||
    value > 127 - SMALL_STEPS
  );
}

function looksRelative(held: readonly number[]) {
  return held.some((value, index) => {
    const previous = held[index - 1];
    return (
      previous !== undefined &&
      (value === previous ||
        Math.sign(relativeSteps(value)) !== Math.sign(relativeSteps(previous)))
    );
  });
}

type CcKind = "absolute" | "relative" | number[];

/**
 * Reads one device's CCs that no entry calls relative, in the order it sends
 * them: where each moves its target, or nothing while it's still unknown.
 */
export function relativeCcReader() {
  const kinds = new Map<string, CcKind>();
  return ({
    channel,
    controller,
    value,
  }: CcMessage): DeviceControlMove | undefined => {
    const id = `${channel}:${controller}`;
    const kind = kinds.get(id) ?? [];
    if (kind === "absolute") {
      return { to: value / 127 };
    }
    if (kind === "relative") {
      return { by: relativeSteps(value) / 127 };
    }
    const held = [...kind, value];
    if (isSmallStep(value) && looksRelative(held)) {
      kinds.set(id, "relative");
      const steps = held.reduce((sum, item) => sum + relativeSteps(item), 0);
      return { by: steps / 127 };
    }
    if (!isSmallStep(value) || held.length >= HELD_POSITIONS) {
      kinds.set(id, "absolute");
      return { to: value / 127 };
    }
    kinds.set(id, held);
    return undefined;
  };
}
