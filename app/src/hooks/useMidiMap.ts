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
import { midiKeyEvent } from "../midi-input/keyboard-layout.ts";
import type { MidiMessage } from "../midi-input/messages.ts";
import { mpeInputFor } from "../midi-input/mpe.ts";
import {
  assignMidiMapping,
  findMidiMapping,
  midiMappingMatches,
  removeMidiMapping,
} from "../midi-map.ts";
import { pitchName } from "../midi-piano-roll.ts";
import { fireMappedButtons, isKeyForPopup } from "./useKeyMap.ts";

const NO_PADS: ReadonlySet<string> = new Set();
const NOT_MAPPING: KeyMapButtonProps = {};

export type MidiMapInputs = {
  hub?: MidiInputHub;
  keyMap: KeyMapControls;
  effects: SessionEffect[];
  midiMappings: ProjectState["midiMappings"];
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  editEffects: Parameters<typeof fireMappedButtons>[2];
  setStatus: (status: string) => void;
};

// A key as the mappings read it, and its identity while it's down.
function readKey(hub: MidiInputHub, input: MidiInputInfo, message: MidiMessage) {
  const key = midiKeyEvent(message, input.mapping);
  if (!key) {
    return undefined;
  }
  const mpe = mpeInputFor(hub, input.id);
  return {
    ...key,
    id: `${input.id}:${key.channel}:${key.pitch}`,
    mapKey: {
      note: key.pitch,
      channel: key.channel,
      zoneOf: mpe.zoneNameOf,
      isMpe: mpe.isActive(),
    },
  };
}

// MIDI Map mode and the mapped MIDI keys, and the Key Map's controls with it:
// the effect buttons belong to whichever is mapping, and turning one on turns
// the other off, so a click selects a button for one of them. The hub only
// delivers what the MIDI toggle and device selection let through. It's only
// listened to while there's something to hear, so a session without mappings
// doesn't ask for MIDI access on launch.
export function useMidiMap({
  hub = midiInputHub,
  keyMap,
  effects,
  midiMappings,
  commitProjectChange,
  editEffects,
  setStatus,
}: MidiMapInputs): { keyMap: KeyMapControls; midiMap: KeyMapControls } {
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
    editEffects,
  });
  latestRef.current = {
    active,
    selected: selectedTarget,
    effects,
    midiMappings,
    commitProjectChange,
    editEffects,
  };

  const listening = active || Boolean(midiMappings?.length);
  useEffect(() => {
    if (!listening) {
      return undefined;
    }
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
    const targetsOf = (mapKey: NonNullable<ReturnType<typeof readKey>>) => {
      const { effects: current, midiMappings: mappings } = latestRef.current;
      return (mappings ?? []).flatMap((mapping) =>
        midiMappingMatches(mapping, mapKey.mapKey) &&
        pressKeyMapTarget(current, mapping.target)
          ? [mapping.target]
          : [],
      );
    };

    const stopListening = hub.listen({
      claims(input, message) {
        // Zones and channels played have to be known with no piano roll open.
        // A roll hearing the same message as well changes nothing.
        const mpe = mpeInputFor(hub, input.id);
        const key = readKey(hub, input, message);
        if (!key) {
          mpe.receive(message);
          return false;
        }
        if (!key.down) {
          mpe.released(key.channel, key.pitch);
          return heldKeys.has(key.id);
        }
        mpe.pressed(key.channel, key.pitch);
        return (
          latestRef.current.active ||
          targetsOf(readKey(hub, input, message) ?? key).length > 0
        );
      },
      message(input, message) {
        const key = readKey(hub, input, message);
        if (!key) {
          return;
        }
        releaseKey(key.id);
        if (!key.down) {
          return;
        }
        const latest = latestRef.current;
        if (latest.active) {
          heldKeys.set(key.id, []);
          const { selected: target } = latest;
          if (target) {
            const { pitch: note, channel } = key;
            const mpe = key.mapKey.isMpe ? { mpe: true as const } : {};
            latest.commitProjectChange("Map MIDI Key", (current) =>
              patchProjectState(current, {
                midiMappings: assignMidiMapping(current.midiMappings, {
                  note,
                  channel,
                  ...mpe,
                  target,
                }),
              }),
            );
          }
          return;
        }
        const { pads } = fireMappedButtons(
          targetsOf(key),
          latest.effects,
          latest.editEffects,
        );
        heldKeys.set(key.id, pads);
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

  const toggle = useCallback(() => {
    const next = !latestRef.current.active;
    if (next && keyMapRef.current.active) {
      keyMapRef.current.toggle();
    }
    setActive(next);
    setSelected(null);
    if (!next) {
      setStatus("MIDI Use mode.");
    } else if (hub.getState().enabled) {
      setStatus(
        "MIDI Map mode: click an effect button, then press a MIDI key. Delete removes its key, Esc cancels.",
      );
    } else {
      setStatus(
        "MIDI Map mode: turn MIDI on in a piano roll's header to assign keys.",
      );
    }
  }, [hub, setStatus]);

  const keyMapRef = useRef(keyMap);
  keyMapRef.current = keyMap;

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
    const isPadHeld = (effectId: string, pad: number) =>
      keyMap.isPadHeld(effectId, pad) || heldPads.has(`${effectId}:${pad}`);
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
        isPadHeld,
      },
      midiMap: {
        active,
        toggle,
        buttonProps: midiButtonProps,
        isPadHeld,
      },
    };
  }, [active, heldPads, keyMap, midiMappings, selectedTarget, toggle]);
}
