// MIDI Polyphonic Expression, as one device plays it: each note gets a member
// channel of its own within a lower or upper zone, so a channel's pitch bend,
// pressure and CC 74 (slide, or timbre) are that note's alone, and the zone's
// manager channel speaks for every note in the zone.
//
// A device says it plays MPE with an MPE Configuration Message, but usually
// when it starts up, before the app is listening. So a device that hasn't
// sent one counts as MPE, in the specification's default zone, once it has
// played on two member channels. A keyboard on one channel, or keys on the
// first channel with pads on the tenth, never does, and its wheel and pressure
// keep doing nothing.
import type { ExpressionSample } from "../midi-clip.ts";
import type { MidiMessage } from "./messages.ts";

const LOWER_MANAGER = 1;
const UPPER_MANAGER = 16;
const LAST_CHANNEL = 16;
// The specification's default pitch bend ranges, in semitones.
const DEFAULT_MEMBER_BEND_RANGE = 48;
const DEFAULT_MANAGER_BEND_RANGE = 2;
const CC_DATA_MSB = 6;
const CC_DATA_LSB = 38;
const CC_TIMBRE = 74;
const CC_RPN_LSB = 100;
const CC_RPN_MSB = 101;
const RPN_BEND_RANGE = 0;
const RPN_MPE_CONFIGURATION = 6;
const BEND_CENTER = 8192;

// What a manager channel or member channel has said. `bend` is from -1 to 1.
// Pressure and timbre are unset until something sets them.
type ChannelExpression = { bend: number; pressure?: number; timbre?: number };

type Zone = {
  manager: number;
  // How many channels it has beyond its manager.
  members: number;
  memberBendRange: number;
  managerBendRange: number;
  managerExpression: ChannelExpression;
};

// What a channel has said, the notes held on it and the RPN it has selected.
type ChannelState = ChannelExpression & {
  notes: Set<number>;
  rpn: { msb?: number; lsb?: number };
};

export type MpeInput = {
  /** Reads a bend, pressure, CC 74 or configuration message. */
  receive: (message: MidiMessage) => void;
  pressed: (channel: number, pitch: number) => void;
  released: (channel: number, pitch: number) => void;
  /** Whether the device has been shown to play MPE. */
  isActive: () => boolean;
  /** The zone `channel` belongs to, or undefined outside every zone. */
  zoneNameOf: (channel: number) => "lower" | "upper" | undefined;
  /** A channel's expression now, or undefined outside every zone. */
  sampleOf: (channel: number) => ExpressionSample | undefined;
  /** Forgets every held note, keeping the zones, as when a device goes away. */
  releaseAll: () => void;
};

function zone(manager: number, members: number): Zone {
  return {
    manager,
    members,
    memberBendRange: DEFAULT_MEMBER_BEND_RANGE,
    managerBendRange: DEFAULT_MANAGER_BEND_RANGE,
    managerExpression: { bend: 0 },
  };
}

function normalizedBend(value: number) {
  const offset = value - BEND_CENTER;
  // Fourteen bits reach one step further down than up.
  return offset / (offset < 0 ? BEND_CENTER : BEND_CENTER - 1);
}

export function createMpeInput(): MpeInput {
  const channels = new Map<number, ChannelState>();
  const zones: { lower?: Zone; upper?: Zone } = {
    lower: zone(LOWER_MANAGER, LAST_CHANNEL - 1),
  };
  let configured = false;
  const playedMembers = new Set<number>();

  function stateOf(channel: number) {
    let state = channels.get(channel);
    if (!state) {
      state = { bend: 0, notes: new Set(), rpn: {} };
      channels.set(channel, state);
    }
    return state;
  }

  function zoneOf(channel: number) {
    const { lower, upper } = zones;
    if (lower && channel <= LOWER_MANAGER + lower.members) {
      return lower;
    }
    return upper && channel >= UPPER_MANAGER - upper.members
      ? upper
      : undefined;
  }

  // Clears what a zone's members said of `name`, which its manager just spoke
  // over.
  function clearMembers(target: Zone, name: "pressure" | "timbre") {
    for (const [channel, state] of channels) {
      if (channel !== target.manager && zoneOf(channel) === target) {
        delete state[name];
      }
    }
  }

  function configure(manager: number, requested: number) {
    if (!configured) {
      // The device says what its zones are, so the assumed one goes.
      zones.lower = undefined;
      configured = true;
    }
    const members = Math.min(LAST_CHANNEL - 1, requested);
    const isLower = manager === LOWER_MANAGER;
    const name = isLower ? "lower" : "upper";
    const other = isLower ? "upper" : "lower";
    zones[name] = members ? zone(manager, members) : undefined;
    const otherZone = zones[other];
    // The new zone takes the channels it overlaps from the other one.
    if (otherZone && members) {
      otherZone.members = Math.min(
        otherZone.members,
        LAST_CHANNEL - 2 - members,
      );
      if (otherZone.members <= 0) {
        zones[other] = undefined;
      }
    }
    for (const state of channels.values()) {
      state.bend = 0;
      delete state.pressure;
      delete state.timbre;
    }
  }

  function setBendRange(target: Zone, channel: number, range: number) {
    if (channel === target.manager) {
      target.managerBendRange = range;
    } else {
      target.memberBendRange = range;
    }
  }

  function receiveData(channel: number, controller: number, value: number) {
    const { rpn } = stateOf(channel);
    if (rpn.msb !== 0) {
      return;
    }
    const target = zoneOf(channel);
    if (rpn.lsb === RPN_MPE_CONFIGURATION) {
      if (
        controller === CC_DATA_MSB &&
        (channel === LOWER_MANAGER || channel === UPPER_MANAGER)
      ) {
        configure(channel, value);
      }
    } else if (rpn.lsb === RPN_BEND_RANGE && target) {
      if (controller === CC_DATA_MSB) {
        setBendRange(target, channel, value);
      } else {
        const range =
          channel === target.manager
            ? target.managerBendRange
            : target.memberBendRange;
        setBendRange(target, channel, Math.floor(range) + value / 100);
      }
    }
  }

  function receiveCc(channel: number, controller: number, value: number) {
    if (controller === CC_RPN_MSB) {
      stateOf(channel).rpn.msb = value;
    } else if (controller === CC_RPN_LSB) {
      stateOf(channel).rpn.lsb = value;
    } else if (controller === CC_DATA_MSB || controller === CC_DATA_LSB) {
      receiveData(channel, controller, value);
    } else if (controller === CC_TIMBRE) {
      setExpression(channel, "timbre", value / 127);
    }
  }

  // A zone's pressure and timbre are whichever of its manager's or a note's
  // channel spoke last. Bends add up, as a wheel moves notes already sliding.
  function setExpression(
    channel: number,
    name: "bend" | "pressure" | "timbre",
    value: number,
  ) {
    const target = zoneOf(channel);
    if (!target) {
      return;
    }
    if (channel === target.manager) {
      target.managerExpression[name] = value;
      if (name !== "bend") {
        clearMembers(target, name);
      }
    } else {
      stateOf(channel)[name] = value;
    }
  }

  return {
    receive(message) {
      if (message.type === "pitchbend") {
        setExpression(message.channel, "bend", normalizedBend(message.value));
      } else if (message.type === "pressure") {
        setExpression(message.channel, "pressure", message.value / 127);
      } else if (message.type === "cc") {
        receiveCc(message.channel, message.controller, message.value);
      }
    },
    pressed(channel, pitch) {
      stateOf(channel).notes.add(pitch);
      const target = zoneOf(channel);
      if (target && channel !== target.manager) {
        playedMembers.add(channel);
      }
    },
    released(channel, pitch) {
      const state = stateOf(channel);
      state.notes.delete(pitch);
      if (!state.notes.size) {
        // The next note on the channel starts from what's sent before it.
        state.bend = 0;
        delete state.pressure;
        delete state.timbre;
      }
    },
    isActive() {
      return configured
        ? Boolean(zones.lower || zones.upper)
        : playedMembers.size >= 2;
    },
    zoneNameOf(channel) {
      const target = zoneOf(channel);
      if (!target) {
        return undefined;
      }
      return target === zones.lower ? "lower" : "upper";
    },
    sampleOf(channel) {
      const target = zoneOf(channel);
      if (!target) {
        return undefined;
      }
      const manager = target.managerExpression;
      const member = channel === target.manager ? undefined : stateOf(channel);
      const pressure = member?.pressure ?? manager.pressure;
      const timbre = member?.timbre ?? manager.timbre;
      return {
        bend:
          (member?.bend ?? 0) * target.memberBendRange +
          manager.bend * target.managerBendRange,
        ...(pressure === undefined ? {} : { pressure }),
        ...(timbre === undefined ? {} : { timbre }),
      };
    },
    releaseAll() {
      for (const state of channels.values()) {
        state.notes.clear();
        state.bend = 0;
        delete state.pressure;
        delete state.timbre;
      }
      for (const target of [zones.lower, zones.upper]) {
        if (target) {
          target.managerExpression = { bend: 0 };
        }
      }
    },
  };
}

const inputsByOwner = new WeakMap<object, Map<string, MpeInput>>();

/**
 * The MPE state of input `id` of `owner`, a MIDI hub: a device's zones outlive
 * the piano roll that heard them, since it won't send them again.
 */
export function mpeInputFor(owner: object, id: string) {
  let inputs = inputsByOwner.get(owner);
  if (!inputs) {
    inputs = new Map();
    inputsByOwner.set(owner, inputs);
  }
  let input = inputs.get(id);
  if (!input) {
    input = createMpeInput();
    inputs.set(id, input);
  }
  return input;
}
