// The MIDI Map: MIDI keys mapped to buttons in effect devices, as the Key Map
// (key-map.ts) maps computer keys, and to the same targets. A mapping matches
// a note and channel on whichever device plays it. One key can drive several
// buttons; each button has one key.
import type { SessionEffect } from "./fx-stack.ts";
import {
  type KeyMapTarget,
  keyMapTargetId,
  readKeyMapTarget,
} from "./key-map.ts";

export type MidiMapping = {
  note: number;
  channel: number;
  // Assigned from a device playing MPE, whose notes each get their own channel
  // of a zone: it matches the note anywhere in `channel`'s zone.
  mpe?: true;
  target: KeyMapTarget;
};

/** A key as a device plays it. */
export type MidiMapKey = {
  note: number;
  channel: number;
  // The device's MPE zone of a channel, and whether it has shown it plays MPE.
  zoneOf: (channel: number) => string | undefined;
  isMpe: boolean;
};

export function midiMappingMatches(mapping: MidiMapping, key: MidiMapKey) {
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

export function findMidiMapping(
  mappings: readonly MidiMapping[] | undefined,
  target: KeyMapTarget,
) {
  const id = keyMapTargetId(target);
  return mappings?.find((mapping) => keyMapTargetId(mapping.target) === id);
}

/** `mappings` without `target`'s; undefined once none are left. */
export function removeMidiMapping(
  mappings: readonly MidiMapping[] | undefined,
  target: KeyMapTarget,
) {
  const existing = findMidiMapping(mappings, target);
  if (!existing) {
    return mappings;
  }
  const rest = mappings?.filter((mapping) => mapping !== existing);
  return rest?.length ? rest : undefined;
}

/** Maps a key to `mapping.target`, in place of any key it had. */
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
    const { note, channel, mpe } = entry ?? {};
    if (target && inRange(note, 0, 127) && inRange(channel, 1, 16)) {
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
