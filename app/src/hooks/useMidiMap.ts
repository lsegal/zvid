import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { isEditableEventTarget } from "../app/util.ts";
import type {
  KeyMapButtonProps,
  KeyMapControls,
} from "../components/fx/key-map-context.ts";
import type { SessionEffect } from "../fx-stack.ts";
import {
  type KeyMapTarget,
  keyMapTargetId,
  pressKeyMapTarget,
} from "../key-map.ts";
import {
  type MidiInputHub,
  type MidiInputInfo,
  midiInputHub,
} from "../midi-input/input-hub.ts";
import {
  type MidiKeyEvent,
  midiKeyEvent,
} from "../midi-input/keyboard-layout.ts";
import { mpeInputFor } from "../midi-input/mpe.ts";
import {
  assignMidiMapping,
  findMidiMapping,
  learnMidiMappingsMpe,
  type MidiMapKey,
  midiMappingMatches,
  removeMidiMapping,
} from "../midi-map.ts";
import { pitchName } from "../midi-piano-roll.ts";
import { fireMappedButtons, isKeyForPopup, padId } from "./useKeyMap.ts";

const NO_PADS: ReadonlySet<string> = new Set();
const NOT_MAPPING: KeyMapButtonProps = {};

function heldKeyId(input: MidiInputInfo, { channel, pitch }: MidiKeyEvent) {
  return `${input.id}:${channel}:${pitch}`;
}

export type MidiMapInputs = {
  hub?: MidiInputHub;
  keyMap: KeyMapControls;
  effects: SessionEffect[];
  midiMappings: ProjectState["midiMappings"];
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  amendProject: (updater: (current: ProjectState) => ProjectState) => void;
  editEffects: Parameters<typeof fireMappedButtons>[2];
  setStatus: (status: string) => void;
};

// How the mappings read a key of `input`, from what its device has shown so far.
function mapKeyOf(
  mpeOwner: object,
  input: MidiInputInfo,
  { channel, pitch }: MidiKeyEvent,
): MidiMapKey {
  const mpe = mpeInputFor(mpeOwner, input.id);
  return {
    note: pitch,
    channel,
    zoneOf: mpe.zoneNameOf,
    isMpe: mpe.isActive(),
  };
}

// MIDI Map mode and the mapped MIDI keys, and the Key Map's controls with it:
// the effect buttons belong to whichever is mapping, and turning one on turns
// the other off, so a click selects a button for one of them. The hub only
// delivers what the MIDI control and device selection let through. It's only
// listened to while there's something to hear.
export function useMidiMap({
  hub = midiInputHub,
  keyMap,
  effects,
  midiMappings,
  commitProjectChange,
  amendProject,
  editEffects,
  setStatus,
}: MidiMapInputs): {
  keyMap: KeyMapControls;
  midiMap: Pick<KeyMapControls, "active" | "toggle">;
} {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<KeyMapTarget | null>(null);
  const [heldPads, setHeldPads] = useState(NO_PADS);
  const selectedTarget =
    selected && effects.some((effect) => effect.id === selected.effectId)
      ? selected
      : null;
  const latestRef = useRef({
    active,
    selected: selectedTarget,
    effects,
    midiMappings,
    commitProjectChange,
    amendProject,
    editEffects,
  });
  latestRef.current = {
    active,
    selected: selectedTarget,
    effects,
    midiMappings,
    commitProjectChange,
    amendProject,
    editEffects,
  };

  const listening = active || Boolean(midiMappings?.length);
  useEffect(() => {
    if (!listening) {
      return undefined;
    }
    // What each device has shown of MPE, kept apart from the hub's: it has to
    // be known with no piano roll open, and a roll watches for a device turning
    // out to play MPE as it reads the same messages into the hub's.
    const mpeOwner = {};
    // The keys down that this claimed, with the pads each holds.
    const heldKeys = new Map<string, readonly string[]>();

    const releaseKey = (id: string) => {
      const pads = heldKeys.get(id);
      heldKeys.delete(id);
      if (pads?.length) {
        const stillHeld = new Set([...heldKeys.values()].flat());
        setHeldPads((held) => {
          const next = new Set(held);
          for (const pad of pads) {
            if (!stillHeld.has(pad)) {
              next.delete(pad);
            }
          }
          return next;
        });
      }
    };

    // The buttons a key drives, leaving out any that are gone.
    const targetsOf = (key: MidiMapKey) => {
      const { effects: current, midiMappings: mappings } = latestRef.current;
      return (mappings ?? []).flatMap((mapping) =>
        midiMappingMatches(mapping, key) &&
        pressKeyMapTarget(current, mapping.target)
          ? [mapping.target]
          : [],
      );
    };

    const stopListening = hub.listen({
      claims(input, message) {
        const mpe = mpeInputFor(mpeOwner, input.id);
        const key = midiKeyEvent(message, input.mapping);
        if (!key) {
          mpe.receive(message);
          return false;
        }
        if (!key.down) {
          mpe.released(key.channel, key.pitch);
          return heldKeys.has(heldKeyId(input, key));
        }
        mpe.pressed(key.channel, key.pitch);
        return (
          latestRef.current.active ||
          targetsOf(mapKeyOf(mpeOwner, input, key)).length > 0
        );
      },
      message(input, message) {
        const key = midiKeyEvent(message, input.mapping);
        if (!key) {
          return;
        }
        const id = heldKeyId(input, key);
        releaseKey(id);
        if (!key.down) {
          return;
        }
        const latest = latestRef.current;
        const mapKey = mapKeyOf(mpeOwner, input, key);
        if (latest.active) {
          heldKeys.set(id, []);
          const { selected: target } = latest;
          if (target) {
            const { note, channel, isMpe } = mapKey;
            latest.commitProjectChange("Map MIDI Key", (current) =>
              patchProjectState(current, {
                midiMappings: assignMidiMapping(current.midiMappings, {
                  note,
                  channel,
                  ...(isMpe ? { mpe: true as const } : {}),
                  target,
                }),
              }),
            );
          }
          return;
        }
        // A mapping made before the device was seen to be MPE saves that it is,
        // as one made after does, so it matches from the first press next time.
        if (
          learnMidiMappingsMpe(latest.midiMappings, mapKey) !==
          latest.midiMappings
        ) {
          latest.amendProject((current) =>
            patchProjectState(current, {
              midiMappings: learnMidiMappingsMpe(current.midiMappings, mapKey),
            }),
          );
        }
        const { pads } = fireMappedButtons(
          targetsOf(mapKey),
          latest.effects,
          latest.editEffects,
        );
        heldKeys.set(id, pads);
        if (pads.length) {
          setHeldPads((held) => new Set([...held, ...pads]));
        }
      },
      disconnected(input) {
        for (const id of [...heldKeys.keys()]) {
          if (id.startsWith(`${input.id}:`)) {
            releaseKey(id);
          }
        }
        mpeInputFor(mpeOwner, input.id).releaseAll();
      },
    });
    return () => {
      stopListening();
      setHeldPads(NO_PADS);
    };
  }, [hub, listening]);

  // Delete removes the selected button's key and Escape cancels, as in the
  // Key Map. MIDI keys are what assign.
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const { selected: target, commitProjectChange: commit } =
        latestRef.current;
      if (!target || isEditableEventTarget(event.target) || isKeyForPopup()) {
        return;
      }
      if (event.key === "Escape") {
        setSelected(null);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (!event.repeat) {
          commit("Remove MIDI Mapping", (current) =>
            patchProjectState(current, {
              midiMappings: removeMidiMapping(current.midiMappings, target),
            }),
          );
        }
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active]);

  const keyMapRef = useRef(keyMap);
  keyMapRef.current = keyMap;
  const toggle = useCallback(() => {
    const next = !latestRef.current.active;
    if (next && keyMapRef.current.active) {
      keyMapRef.current.toggle();
    }
    setActive(next);
    setSelected(null);
    setStatus(
      next
        ? "MIDI Map: click an effect button, then press a MIDI key. Delete removes its key, Esc cancels."
        : "MIDI Map off.",
    );
  }, [setStatus]);

  return useMemo(() => {
    const selectedId = selectedTarget && keyMapTargetId(selectedTarget);
    const midiButtonProps = (target: KeyMapTarget): KeyMapButtonProps => {
      if (!active) {
        return NOT_MAPPING;
      }
      const note = findMidiMapping(midiMappings, target)?.note;
      // Stops the press in the capture phase, so the button neither activates
      // nor starts a drag of its device.
      const swallow = (event: { stopPropagation: () => void }) =>
        event.stopPropagation();
      return {
        ...(note === undefined ? {} : { "data-key-map-key": pitchName(note) }),
        "data-key-map":
          keyMapTargetId(target) === selectedId ? "selected" : "mappable",
        onClickCapture: (event) => {
          swallow(event);
          setSelected(target);
        },
        onPointerDownCapture: swallow,
      };
    };
    return {
      keyMap: {
        ...keyMap,
        // Turning the Key Map on takes the buttons back.
        toggle: () => {
          if (active) {
            setActive(false);
            setSelected(null);
          }
          keyMap.toggle();
        },
        buttonProps: active ? midiButtonProps : keyMap.buttonProps,
        isPadHeld: (effectId, pad) =>
          keyMap.isPadHeld(effectId, pad) || heldPads.has(padId(effectId, pad)),
      },
      midiMap: { active, toggle },
    };
  }, [active, heldPads, keyMap, midiMappings, selectedTarget, toggle]);
}
