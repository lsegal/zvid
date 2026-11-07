// What a known device's continuous controls do with no mapping made by hand
// (#1615), worked out from the controls' kinds and names so that every device
// in midi-devices.json follows the same rules: its knobs and encoders, in the
// order the device lists them, are the selected effect's knobs 1 to N; a
// master, lone or ninth fader, or any control named for volume, is the app's volume;
// and numbered faders are the source tracks' volumes, in track order.
//
// Only CC messages, and the pitch bend some faders send, take a role. MIDI Map
// mappings are of notes, so a key mapped by hand is never one of these.
import {
  expandControls,
  type MidiControl,
  type MidiDeviceMapping,
} from "./device-mappings.ts";
import type { MidiMessage } from "./messages.ts";

export type DeviceControlRole =
  | { kind: "fx-knob"; index: number }
  | { kind: "master-volume" }
  | { kind: "track-volume"; index: number };

/** Where a control has moved its target: to a place, or by an amount. Both 0..1. */
export type DeviceControlMove =
  | { to: number; by?: undefined }
  | { by: number; to?: undefined };

const VOLUME_NAME = /volume|^master( fader| encoder| level)?$/i;
// Controls that aren't one continuous value to hand to a parameter: what a
// touch or press on it sends, a mixing control with no meaning here, or one
// that navigates or sets the device's own transport.
const NO_ROLE_NAME =
  /touch$|fader touch|pressure|location|direction|crossfader|drawbar|pitch bend|data entry|tempo|swing|cue|browse|navigat|^main encoder$/i;

function hasRole(control: MidiControl) {
  const message =
    control.type === "cc" ||
    (control.kind === "fader" && control.type === "pitchbend");
  return (
    message &&
    ["knob", "encoder", "fader"].includes(control.kind) &&
    !NO_ROLE_NAME.test(control.name)
  );
}

/** The role of each of `mapping`'s controls that has one. */
export function deviceControlRoles(
  mapping: Pick<MidiDeviceMapping, "controls">,
): { control: MidiControl; role: DeviceControlRole }[] {
  const controls = expandControls(mapping.controls).filter(hasRole);
  const isVolume = (control: MidiControl) => VOLUME_NAME.test(control.name);
  const faders = controls.filter(
    (control) => control.kind === "fader" && !isVolume(control),
  );
  const numbered = faders.filter((control) => /\d/.test(control.name));
  // A device's only fader, unnumbered and with no master, is its volume, and
  // the ninth of nine is the master that follows a controller's eight tracks.
  const master =
    numbered.length === 9
      ? numbered.pop()
      : faders.length === 1 && !numbered.length && !controls.some(isVolume)
        ? faders[0]
        : undefined;
  let knobs = 0;
  return controls.flatMap((control) => {
    if (isVolume(control) || control === master) {
      return [{ control, role: { kind: "master-volume" as const } }];
    }
    if (control.kind !== "fader") {
      const index = knobs;
      knobs += 1;
      return [{ control, role: { kind: "fx-knob" as const, index } }];
    }
    const index = numbered.indexOf(control);
    return index < 0
      ? []
      : [{ control, role: { kind: "track-volume" as const, index } }];
  });
}

function messageId(type: string, channel: number, number?: number) {
  return `${type}:${channel}:${number ?? ""}`;
}

const rolesByMapping = new WeakMap<
  MidiDeviceMapping,
  Map<string, { control: MidiControl; role: DeviceControlRole }>
>();

function rolesOf(mapping: MidiDeviceMapping) {
  let roles = rolesByMapping.get(mapping);
  if (!roles) {
    roles = new Map(
      deviceControlRoles(mapping).map((entry) => [
        messageId(
          entry.control.type,
          entry.control.channel,
          entry.control.number,
        ),
        entry,
      ]),
    );
    rolesByMapping.set(mapping, roles);
  }
  return roles;
}

// A relative encoder sends how far it turned, as a two's complement number of
// seven bits: 1 is one step up, 127 one step down.
function relativeMove(value: number): DeviceControlMove {
  return { by: (value < 64 ? value : value - 128) / 127 };
}

/** What `message` from a device mapped by `mapping` does, if anything. */
export function deviceControlAction(
  mapping: MidiDeviceMapping,
  message: MidiMessage,
): { role: DeviceControlRole; move: DeviceControlMove } | undefined {
  if (message.type === "cc") {
    const entry = rolesOf(mapping).get(
      messageId("cc", message.channel, message.controller),
    );
    return (
      entry && {
        role: entry.role,
        move: entry.control.relative
          ? relativeMove(message.value)
          : { to: message.value / 127 },
      }
    );
  }
  if (message.type === "pitchbend") {
    const entry = rolesOf(mapping).get(
      messageId("pitchbend", message.channel),
    );
    return entry && { role: entry.role, move: { to: message.value / 16383 } };
  }
  return undefined;
}
