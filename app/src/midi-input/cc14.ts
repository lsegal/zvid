// 14-bit CC: a control that sends an MSB on controller N and an LSB on N + 32
// for each move (N below 32). Nothing says a control does this, and a device may
// use the same controllers as separate 7-bit controls, so it's read from how the
// messages arrive: an LSB straight after its MSB makes them one control, until
// an MSB comes without its LSB.
import type { MidiMessage } from "./messages.ts";

type CcMessage = Extract<MidiMessage, { type: "cc" }>;

const LSB_OFFSET = 32;
// A pair goes out as one burst, and the same knob's next move is further off.
const PAIR_MS = 10;
// An LSB on its own only moves a control seen pairing this often, as a device
// may send just the LSB when the MSB hasn't changed. Once could be two separate
// controls moved together.
const LONE_LSB_PAIRINGS = 2;

/**
 * What a message says: the control it belongs to, which is the MSB's for an LSB,
 * and the 0..1 position it reads as a 14-bit control. `to` is left out of a
 * message read as 7-bit.
 */
export type CcReading = CcMessage & { to?: number };

function position(msb: number, lsb: number) {
  return ((msb << 7) | lsb) / 16383;
}

type ChannelState = {
  // The last message, while it's an MSB whose LSB could still come.
  waiting?: { controller: number; value: number; at: number };
  // The controls seen to be 14-bit, by MSB controller.
  pairs: Map<number, { msb: number; pairings: number }>;
};

/** Reads one device's CC messages, in the order it sends them. */
export function cc14Reader(now: () => number = () => performance.now()) {
  const channels = new Map<number, ChannelState>();
  return (message: CcMessage): CcReading => {
    const { channel, controller, value } = message;
    let state = channels.get(channel);
    if (!state) {
      state = { pairs: new Map() };
      channels.set(channel, state);
    }
    const { waiting, pairs } = state;
    state.waiting = undefined;
    if (
      waiting &&
      controller === waiting.controller + LSB_OFFSET &&
      now() - waiting.at <= PAIR_MS
    ) {
      const pairings = (pairs.get(waiting.controller)?.pairings ?? 0) + 1;
      pairs.set(waiting.controller, { msb: waiting.value, pairings });
      return {
        ...message,
        controller: waiting.controller,
        to: position(waiting.value, value),
      };
    }
    if (waiting) {
      pairs.delete(waiting.controller);
    }
    if (controller < LSB_OFFSET) {
      state.waiting = { controller, value, at: now() };
      const pair = pairs.get(controller);
      if (pair) {
        // A new MSB clears the LSB, whose new value is on its way.
        pair.msb = value;
        return { ...message, to: position(value, 0) };
      }
      return message;
    }
    const pair = pairs.get(controller - LSB_OFFSET);
    return pair && pair.pairings >= LONE_LSB_PAIRINGS
      ? {
          ...message,
          controller: controller - LSB_OFFSET,
          to: position(pair.msb, value),
        }
      : message;
  };
}
