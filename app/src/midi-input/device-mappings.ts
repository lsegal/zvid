// What MIDI devices send, as data: a mapping per device (see
// midi-devices.json and its README) records the port names that recognize it
// and the message each of its keys and controls sends at its factory
// defaults. Keys and pads act on the piano roll, and knobs and faders through
// device-controls.ts; the others are known so their messages are recognized
// and ignored.
import type { MidiMessage } from "./messages.ts";

export const MIDI_CONTROL_KINDS = [
  "key",
  "pad",
  "knob",
  "encoder",
  "fader",
  "wheel",
  "button",
  "pedal",
  "strip",
  "joystick",
] as const;

export type MidiControlKind = (typeof MIDI_CONTROL_KINDS)[number];

export const MIDI_CONTROL_TYPES = [
  "note",
  "cc",
  "pitchbend",
  "pressure",
  "program",
  "sysex",
] as const;

export type MidiControlType = (typeof MIDI_CONTROL_TYPES)[number];

/**
 * A control, or with `count` a run of them: its message's note or CC
 * `number` rising by one per control, and `{n}` in its name counting from 1.
 * `channel` runs from 1 to 16. Only note and CC messages have a `number`.
 */
export type MidiControlEntry = {
  name: string;
  kind: MidiControlKind;
  type: MidiControlType;
  channel: number;
  number?: number;
  count?: number;
  // An encoder sending how far it turned, not where it is.
  relative?: true;
};

export type MidiControl = Omit<MidiControlEntry, "count">;

export type MidiDeviceMapping = {
  id: string;
  manufacturer: string;
  model: string;
  // Lowercase fragments of the MIDI port names the device shows up under.
  portNames: string[];
  source: {
    url: string;
    title: string;
    // "documented": the messages were read from the source. "inventory":
    // the source lists the controls but not their messages, which follow
    // the convention for that kind of device.
    verification: "documented" | "inventory";
    // Any exception: a weak source, or controls it couldn't account for.
    note?: string;
  };
  controls: MidiControlEntry[];
};

/** `entries` with each run spread out into its controls. */
export function expandControls(
  entries: readonly MidiControlEntry[],
): MidiControl[] {
  return entries.flatMap(({ count = 1, ...entry }) =>
    Array.from({ length: count }, (_, index) => ({
      ...entry,
      name: entry.name.replaceAll("{n}", String(index + 1)),
      ...(entry.number === undefined ? {} : { number: entry.number + index }),
    })),
  );
}

// Lowercase with everything but letters and digits as single spaces, so
// "2- Launchkey Mini MK3 MIDI" and "LAUNCHKEY-MINI_MK3" compare alike.
function normalizePortName(name: string) {
  return ` ${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * The mapping recognizing the port `portName`: the one with the longest
 * matching port name, so "launchkey 49 mk3" beats "launchkey 49". Fragments
 * match whole words. Undefined for an unrecognized device, which falls back
 * to the standard keyboard layout.
 */
export function matchDeviceMapping(
  portName: string,
  mappings: readonly MidiDeviceMapping[],
): MidiDeviceMapping | undefined {
  const port = normalizePortName(portName);
  let best: MidiDeviceMapping | undefined;
  let bestLength = 0;
  for (const mapping of mappings) {
    for (const name of mapping.portNames) {
      const fragment = normalizePortName(name);
      if (fragment.length > bestLength && port.includes(fragment)) {
        best = mapping;
        bestLength = fragment.length;
      }
    }
  }
  return best;
}

/** The control of `mapping` that sends `message`, if it lists one. */
export function controlForMessage(
  mapping: MidiDeviceMapping,
  message: MidiMessage,
): MidiControl | undefined {
  const type = controlTypeOf(message);
  const number =
    message.type === "note-on" || message.type === "note-off"
      ? message.note
      : message.type === "cc"
        ? message.controller
        : undefined;
  return expandControls(mapping.controls).find(
    (control) =>
      control.type === type &&
      control.channel === message.channel &&
      control.number === number,
  );
}

function controlTypeOf(message: MidiMessage): MidiControlType {
  return message.type === "note-on" || message.type === "note-off"
    ? "note"
    : message.type;
}

/** What's wrong with `mapping`, for validating the data. */
export function mappingProblems(mapping: MidiDeviceMapping): string[] {
  const problems: string[] = [];
  const problem = (text: string) => problems.push(`${mapping.id}: ${text}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(mapping.id ?? "")) {
    problem("id must be kebab-case");
  }
  if (!mapping.manufacturer || !mapping.model) {
    problem("needs a manufacturer and a model");
  }
  if (!mapping.portNames?.length) {
    problem("needs a port name");
  }
  for (const name of mapping.portNames ?? []) {
    if (name !== name.toLowerCase() || !normalizePortName(name).trim()) {
      problem(`port name "${name}" must be lowercase and non-empty`);
    }
  }
  if (!/^https:\/\/\S+$/.test(mapping.source?.url ?? "")) {
    problem("source needs an https url");
  }
  if (!mapping.source?.title) {
    problem("source needs a title");
  }
  if (!["documented", "inventory"].includes(mapping.source?.verification)) {
    problem("source verification must be documented or inventory");
  }
  if (!mapping.controls?.length) {
    problem("needs controls");
    return problems;
  }
  const seen = new Set<string>();
  for (const entry of mapping.controls) {
    if (!entry.name) {
      problem("control without a name");
    }
    if (!MIDI_CONTROL_KINDS.includes(entry.kind)) {
      problem(`${entry.name}: unknown kind ${entry.kind}`);
    }
    if (!MIDI_CONTROL_TYPES.includes(entry.type)) {
      problem(`${entry.name}: unknown type ${entry.type}`);
    }
    if (
      !Number.isInteger(entry.channel) ||
      entry.channel < 1 ||
      entry.channel > 16
    ) {
      problem(`${entry.name}: channel must be 1 to 16`);
    }
    const count = entry.count ?? 1;
    if (!Number.isInteger(count) || count < 1) {
      problem(`${entry.name}: bad count`);
    }
    if (count > 1 && !entry.name.includes("{n}")) {
      problem(`${entry.name}: a run needs {n} in its name`);
    }
    if (entry.relative && entry.type !== "cc") {
      problem(`${entry.name}: only a cc control can be relative`);
    }
    const numbered = entry.type === "note" || entry.type === "cc";
    if (numbered !== (entry.number !== undefined)) {
      problem(`${entry.name}: only note and cc messages have a number`);
    }
    if (
      numbered &&
      (!Number.isInteger(entry.number) ||
        (entry.number as number) < 0 ||
        (entry.number as number) + count - 1 > 127)
    ) {
      problem(`${entry.name}: number out of 0 to 127`);
    }
  }
  for (const control of expandControls(mapping.controls)) {
    if (control.type === "note" || control.type === "cc") {
      const message = `${control.type}:${control.channel}:${control.number}`;
      if (seen.has(message)) {
        problem(`${control.name}: another control sends ${message}`);
      }
      seen.add(message);
    }
  }
  return problems;
}

/** The shipped mappings, loaded on demand: only MIDI users pay for them. */
export async function loadDeviceMappings(): Promise<MidiDeviceMapping[]> {
  const data = await import("./midi-devices.json");
  return data.default as MidiDeviceMapping[];
}
