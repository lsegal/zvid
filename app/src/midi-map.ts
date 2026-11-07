// The MIDI Map: MIDI keys mapped to buttons in effect devices, as the Key Map
// (key-map.ts) maps computer keys, and to the same targets, and CC controls and
// pitch bend faders mapped to their knobs and faders. A mapping matches a note,
// controller or pitch bend and a channel on whichever device sends it. One key or
// control can drive several targets; each target has one.
import type { SessionEffect } from "./fx-stack.ts";
import {
  type KeyMapTarget,
  keyMapTargetId,
  readKeyMapTarget,
} from "./key-map.ts";

/** A knob or fader of an effect device: one of its number parameters. */
export type MidiKnobTarget = {
  kind: "number";
  effectId: string;
  parameter: string;
};

export type MidiMapTarget = KeyMapTarget | MidiKnobTarget;

export type MidiNoteMapping = {
  note: number;
  channel: number;
  // Assigned from a device playing MPE, whose notes each get their own channel
  // of a zone: it matches the note anywhere in `channel`'s zone.
  mpe?: true;
  controller?: undefined;
  pitchBend?: undefined;
  target: KeyMapTarget;
};

export type MidiCcMapping = {
  controller: number;
  channel: number;
  note?: undefined;
  mpe?: undefined;
  pitchBend?: undefined;
  target: MidiKnobTarget;
};

/** A channel's pitch bend, as a fader in Mackie mode sends it. */
export type MidiPitchBendMapping = {
  pitchBend: true;
  channel: number;
  note?: undefined;
  controller?: undefined;
  mpe?: undefined;
  target: MidiKnobTarget;
};

export type MidiMapping =
  | MidiNoteMapping
  | MidiCcMapping
  | MidiPitchBendMapping;

/** A key as a device plays it. */
export type MidiMapKey = {
  note: number;
  channel: number;
  // The device's MPE zone of a channel, and whether it has shown it plays MPE.
  zoneOf: (channel: number) => string | undefined;
  isMpe: boolean;
};

export function midiMappingMatches(
  mapping: MidiMapping,
  key: MidiMapKey,
): mapping is MidiNoteMapping {
  if (mapping.note !== key.note) {
    return false;
  }
  if (mapping.channel === key.channel) {
    return true;
  }
  // A mapping made before the device was seen to be MPE matches once it is.
  if (!mapping.mpe && !key.isMpe) {
    return false;
  }
  const zone = key.zoneOf(key.channel);
  return zone !== undefined && zone === key.zoneOf(mapping.channel);
}

/**
 * `mappings` with those `key` plays marked as MPE, once its device has shown it
 * plays MPE: the same array when none need it.
 */
export function learnMidiMappingsMpe(
  mappings: readonly MidiMapping[] | undefined,
  key: MidiMapKey,
) {
  if (!key.isMpe || key.zoneOf(key.channel) === undefined) {
    return mappings;
  }
  const learns = (mapping: MidiMapping): mapping is MidiNoteMapping =>
    !mapping.mpe && midiMappingMatches(mapping, key);
  return mappings?.some(learns)
    ? mappings.map((mapping) =>
        learns(mapping) ? { ...mapping, mpe: true as const } : mapping,
      )
    : mappings;
}

/** The knobs and faders mapped to `controller` on `channel`. */
export function midiCcTargets(
  mappings: readonly MidiMapping[] | undefined,
  channel: number,
  controller: number,
) {
  return (mappings ?? []).flatMap((mapping) =>
    mapping.controller === controller && mapping.channel === channel
      ? [mapping.target]
      : [],
  );
}

/** The knobs and faders mapped to the pitch bend of `channel`. */
export function midiPitchBendTargets(
  mappings: readonly MidiMapping[] | undefined,
  channel: number,
) {
  return (mappings ?? []).flatMap((mapping) =>
    mapping.pitchBend && mapping.channel === channel ? [mapping.target] : [],
  );
}

/**
 * The note that touching the fader on `channel` holds down, in Mackie Control:
 * note 104 on the first channel for the first fader, and on up from there.
 */
export function faderTouchNote(channel: number) {
  return { channel: 1, pitch: 103 + channel };
}

export function findMidiMapping(
  mappings: readonly MidiMapping[] | undefined,
  target: MidiMapTarget,
) {
  const id = keyMapTargetId(target);
  return mappings?.find((mapping) => keyMapTargetId(mapping.target) === id);
}

/** `mappings` without `target`'s; undefined once none are left. */
export function removeMidiMapping(
  mappings: readonly MidiMapping[] | undefined,
  target: MidiMapTarget,
) {
  const existing = findMidiMapping(mappings, target);
  if (!existing) {
    return mappings;
  }
  const rest = mappings?.filter((mapping) => mapping !== existing);
  return rest?.length ? rest : undefined;
}

/** Maps a key or control to `mapping.target`, in place of any it had. */
export function assignMidiMapping(
  mappings: readonly MidiMapping[] | undefined,
  mapping: MidiMapping,
) {
  return [...(removeMidiMapping(mappings, mapping.target) ?? []), mapping];
}

/**
 * `mappings` without those of effects that are gone: the same array when none
 * are, and undefined once none are left.
 */
export function pruneMidiMappings(
  mappings: readonly MidiMapping[] | undefined,
  effects: readonly SessionEffect[],
) {
  const ids = new Set(effects.map((effect) => effect.id));
  const kept = mappings?.filter((mapping) => ids.has(mapping.target.effectId));
  if (kept?.length === mappings?.length) {
    return mappings;
  }
  return kept?.length ? kept : undefined;
}

function readKnobTarget(raw: unknown): MidiKnobTarget | undefined {
  const target = raw as Partial<Record<string, unknown>> | null;
  const { kind, effectId, parameter } = target ?? {};
  return kind === "number" &&
    typeof effectId === "string" &&
    typeof parameter === "string"
    ? { kind, effectId, parameter }
    : undefined;
}

function inRange(value: unknown, low: number, high: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= low &&
    value <= high
  );
}

/**
 * The usable mappings of an opened session: those of effects it has, one per
 * button. Undefined when it has none, as a session from before them does.
 */
export function readMidiMappings(
  raw: unknown,
  effects: readonly SessionEffect[],
): readonly MidiMapping[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  let mappings: readonly MidiMapping[] | undefined;
  for (const entry of raw) {
    const target = readKeyMapTarget(entry?.target);
    const knob = readKnobTarget(entry?.target);
    const { note, controller, pitchBend, channel, mpe } = entry ?? {};
    if (knob && pitchBend === true && inRange(channel, 1, 16)) {
      mappings = assignMidiMapping(mappings, {
        pitchBend,
        channel,
        target: knob,
      });
    } else if (knob && inRange(controller, 0, 127) && inRange(channel, 1, 16)) {
      mappings = assignMidiMapping(mappings, {
        controller,
        channel,
        target: knob,
      });
    } else if (target && inRange(note, 0, 127) && inRange(channel, 1, 16)) {
      mappings = assignMidiMapping(mappings, {
        note,
        channel,
        ...(mpe === true ? { mpe } : {}),
        target,
      });
    }
  }
  return pruneMidiMappings(mappings, effects);
}
