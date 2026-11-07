import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { isEditableEventTarget } from "../app/util.ts";
import type {
  KeyMapButtonProps,
  KeyMapControls,
} from "../components/fx/key-map-context.ts";
import { effectHistoryLabels, type SessionEffect } from "../fx-stack.ts";
import { keyMapTargetId, pressKeyMapTarget } from "../key-map.ts";
import { knobParameter, moveEffectParameter } from "../midi-device-targets.ts";
import { type CcReading, cc14Reader } from "../midi-input/cc14.ts";
import {
  ccMoveReader,
  type DeviceControlMove,
  isRelativeCc,
  pitchBendMove,
} from "../midi-input/device-controls.ts";
import {
  type MidiInputHub,
  type MidiInputInfo,
  midiInputHub,
} from "../midi-input/input-hub.ts";
import {
  type MidiKeyEvent,
  midiKeyEvent,
} from "../midi-input/keyboard-layout.ts";
import type { MidiMessage } from "../midi-input/messages.ts";
import { BEND_CENTER, mpeInputFor } from "../midi-input/mpe.ts";
import {
  assignMidiMapping,
  faderTouchNote,
  findMidiMapping,
  learnMidiMappingsMpe,
  type MidiKnobTarget,
  type MidiMapKey,
  type MidiMapping,
  type MidiMapTarget,
  midiCcTargets,
  midiMappingMatches,
  midiPitchBendTargets,
  removeMidiMapping,
} from "../midi-map.ts";
import { pitchName } from "../midi-piano-roll.ts";
import {
  type SettledEditEffects,
  settledEffectEdits,
} from "./settled-effect-edits.ts";
import { fireMappedButtons, isKeyForPopup, padId } from "./useKeyMap.ts";

const NO_PADS: ReadonlySet<string> = new Set();
const NOT_MAPPING: KeyMapButtonProps = {};

// How long a bend begun with a key down has to rest before it can assign.
const WHEEL_REST_MS = 1000;

type CcMessage = Extract<MidiMessage, { type: "cc" }>;
type BendMessage = Extract<MidiMessage, { type: "pitchbend" }>;
type KnobReading = CcReading | BendMessage;

function heldKeyId(
  input: MidiInputInfo,
  { channel, pitch }: Pick<MidiKeyEvent, "channel" | "pitch">,
) {
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
  editEffects: SettledEditEffects;
  setStatus: (status: string) => void;
};

// What a mapped key or control shows on its button or knob while mapping.
function mappingLabel(mapping: MidiMapping | undefined) {
  if (!mapping) {
    return undefined;
  }
  if (mapping.pitchBend) {
    return `PB ${mapping.channel}`;
  }
  return mapping.controller === undefined
    ? pitchName(mapping.note)
    : `CC ${mapping.controller}`;
}

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

// MIDI Map mode, the mapped MIDI keys and controls, and the Key Map's controls
// with it: the effect buttons belong to whichever is mapping, and turning one on
// turns the other off, so a click selects a button for one of them. Knobs and
// faders are the MIDI Map's alone. A mapped CC or pitch bend is claimed, which
// keeps it from a device's built-in role (#1615). The hub only delivers what the
// MIDI control and device selection let through. It's only listened to while
// there's something to hear.
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
  const [selected, setSelected] = useState<MidiMapTarget | null>(null);
  const [heldPads, setHeldPads] = useState(NO_PADS);
  const selectedTarget =
    selected && effects.some((effect) => effect.id === selected.effectId)
      ? selected
      : null;
  // The last control assigned, until the assignment has rendered: a control
  // sends a run of messages, and they make one mapping and one undo step.
  const assigningRef = useRef<string | null>(null);
  const latestRef = useRef({
    active,
    selected: selectedTarget,
    effects,
    midiMappings,
    commitProjectChange,
    amendProject,
    editEffects,
  });
  if (latestRef.current.midiMappings !== midiMappings) {
    assigningRef.current = null;
  }
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
    // When each channel's bend was last taken for a wheel, by input and channel.
    const wheelBends = new Map<string, number>();
    // Each device's 14-bit controls, and the reading of the message in hand:
    // the hub asks to claim a message before delivering it.
    const cc14Readers = new Map<string, ReturnType<typeof cc14Reader>>();
    // Each device's 7-bit controls, read in order to tell encoders from knobs.
    const moveReaders = new Map<string, ReturnType<typeof ccMoveReader>>();
    let reading: KnobReading | undefined;
    // Where the message in hand moves its knobs: nothing while it's held.
    let move: DeviceControlMove | undefined;
    const { edit: editSettled, flush } = settledEffectEdits((...args) =>
      latestRef.current.editEffects(...args),
    );

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

    // The knobs and faders a CC or pitch bend drives, leaving out any that are
    // gone.
    const knobsOf = (message: KnobReading) => {
      const { effects: current, midiMappings: mappings } = latestRef.current;
      const targets =
        message.type === "cc"
          ? midiCcTargets(mappings, message.channel, message.controller)
          : midiPitchBendTargets(mappings, message.channel);
      return targets.flatMap((target) => {
        const effect = current.find((item) => item.id === target.effectId);
        return effect && knobParameter(effect, target.parameter)
          ? [{ target, effect }]
          : [];
      });
    };

    // Relative encoders send steps, which have no second half to pair.
    const readCc = (input: MidiInputInfo, message: CcMessage): CcReading => {
      if (isRelativeCc(input.mapping, message)) {
        return message;
      }
      let read = cc14Readers.get(input.id);
      if (!read) {
        read = cc14Reader();
        cc14Readers.set(input.id, read);
      }
      return read(message);
    };

    const readMove = (
      input: MidiInputInfo,
      read: KnobReading,
    ): DeviceControlMove | undefined => {
      if (read.type === "pitchbend") {
        return pitchBendMove(read);
      }
      if (read.to !== undefined) {
        return { to: read.to };
      }
      let readMoves = moveReaders.get(input.id);
      if (!readMoves) {
        readMoves = ccMoveReader();
        moveReaders.set(input.id, readMoves);
      }
      return readMoves(input.mapping, read);
    };

    // Whether a key of `input` is down, other than the note that touching the
    // fader on `channel` holds.
    const keyHeldFor = (input: MidiInputInfo, channel: number) => {
      const touch = heldKeyId(input, faderTouchNote(channel));
      return [...heldKeys.keys()].some(
        (id) => id !== touch && id.startsWith(`${input.id}:`),
      );
    };

    // Whether a bend is a fader being moved, as far as can be told, rather than
    // a wheel played along with a note or springing back from one.
    const bendAssigns = (
      input: MidiInputInfo,
      { channel, value }: BendMessage,
    ) => {
      const id = `${input.id}:${channel}`;
      const now = performance.now();
      if (
        keyHeldFor(input, channel) ||
        mpeInputFor(mpeOwner, input.id).isActive()
      ) {
        wheelBends.set(id, now);
        return false;
      }
      if (value === BEND_CENTER) {
        wheelBends.delete(id);
        return false;
      }
      const last = wheelBends.get(id);
      if (last !== undefined && now - last < WHEEL_REST_MS) {
        wheelBends.set(id, now);
        return false;
      }
      wheelBends.delete(id);
      return true;
    };

    const assignControl = (target: MidiKnobTarget, message: KnobReading) => {
      const latest = latestRef.current;
      const { channel } = message;
      const mapping: MidiMapping =
        message.type === "cc"
          ? { controller: message.controller, channel, target }
          : { pitchBend: true, channel, target };
      const existing = findMidiMapping(latest.midiMappings, target);
      const id = `${mappingLabel(mapping)}:${channel}:${keyMapTargetId(target)}`;
      if (
        (existing?.channel === channel &&
          mappingLabel(existing) === mappingLabel(mapping)) ||
        assigningRef.current === id
      ) {
        return;
      }
      assigningRef.current = id;
      latest.commitProjectChange("Map MIDI Control", (current) =>
        patchProjectState(current, {
          midiMappings: assignMidiMapping(current.midiMappings, mapping),
        }),
      );
    };

    const moveKnobs = (message: KnobReading, move: DeviceControlMove) => {
      const knobs = knobsOf(message);
      const [first] = knobs;
      if (!first) {
        return;
      }
      editSettled(
        effectHistoryLabels.parameter(
          first.effect.effectName,
          first.target.parameter,
        ),
        (effects) =>
          knobs.reduce(
            (next, { target }) =>
              moveEffectParameter(
                next,
                target.effectId,
                target.parameter,
                move,
              ),
            effects,
          ),
      );
    };

    const stopListening = hub.listen({
      claims(input, message) {
        const mpe = mpeInputFor(mpeOwner, input.id);
        const key = midiKeyEvent(message, input.mapping);
        if (!key) {
          mpe.receive(message);
          if (message.type !== "cc" && message.type !== "pitchbend") {
            return false;
          }
          reading = message.type === "cc" ? readCc(input, message) : message;
          move = readMove(input, reading);
          return (
            latestRef.current.selected?.kind === "number" ||
            knobsOf(reading).length > 0
          );
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
          if (
            (message.type === "cc" || message.type === "pitchbend") &&
            reading
          ) {
            const { active: mapping, selected: target } = latestRef.current;
            if (!mapping) {
              if (move) {
                moveKnobs(reading, move);
              }
            } else if (
              target?.kind === "number" &&
              (reading.type === "cc" || bendAssigns(input, reading))
            ) {
              assignControl(target, reading);
            }
          }
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
          if (target && target.kind !== "number") {
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
        cc14Readers.delete(input.id);
      },
    });
    return () => {
      stopListening();
      flush();
      setHeldPads(NO_PADS);
    };
  }, [hub, listening]);

  // Delete removes the selected button's key and Escape cancels, as in the
  // Key Map. MIDI keys and controls are what assign.
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
        ? "MIDI Map: click an effect button, knob or fader, then press a MIDI key or move a control. Delete removes its mapping, Esc cancels."
        : "MIDI Map off.",
    );
  }, [setStatus]);

  return useMemo(() => {
    const selectedId = selectedTarget && keyMapTargetId(selectedTarget);
    const midiButtonProps = (target: MidiMapTarget): KeyMapButtonProps => {
      if (!active) {
        return NOT_MAPPING;
      }
      const label = mappingLabel(findMidiMapping(midiMappings, target));
      // Stops the press in the capture phase, so the button neither activates
      // nor starts a drag of its device.
      const swallow = (event: { stopPropagation: () => void }) =>
        event.stopPropagation();
      return {
        ...(label === undefined ? {} : { "data-key-map-key": label }),
        "data-key-map":
          keyMapTargetId(target) === selectedId ? "selected" : "mappable",
        onClickCapture: (event) => {
          swallow(event);
          setSelected(target);
        },
        // A knob's or fader's double click resets it.
        onDoubleClickCapture: swallow,
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
        knobProps: active ? midiButtonProps : keyMap.knobProps,
        isPadHeld: (effectId, pad) =>
          keyMap.isPadHeld(effectId, pad) || heldPads.has(padId(effectId, pad)),
      },
      midiMap: { active, toggle },
    };
  }, [active, heldPads, keyMap, midiMappings, selectedTarget, toggle]);
}
