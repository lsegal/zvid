import { useEffect, useRef } from "react";
import { effectHistoryLabels, type SessionEffect } from "../fx-stack.ts";
import { deviceControlAction } from "../midi-input/device-controls.ts";
import { type MidiInputHub, midiInputHub } from "../midi-input/input-hub.ts";
import {
  knobParameters,
  moveEffectKnob,
  movePosition,
  moveTrackVolume,
} from "../midi-device-targets.ts";
import type { useFxEditing } from "./useFxEditing.ts";

// How long a control rests before its moves become one undo step.
const SETTLE_MS = 400;

export type MidiDeviceControlInputs = {
  hub?: MidiInputHub;
  effects: SessionEffect[];
  selectedEffectId: string | undefined;
  sourceTrackIds: readonly string[];
  editEffects: ReturnType<typeof useFxEditing>["editEffects"];
  previewVolume: number;
  setPreviewVolume: (volume: number) => void;
};

// A known device's knobs and faders, with nothing to map (#1615). The hub only
// delivers what the MIDI control and device selection let through, and asks for
// MIDI access only once MIDI is turned on.
export function useMidiDeviceControls({
  hub = midiInputHub,
  ...inputs
}: MidiDeviceControlInputs) {
  const latestRef = useRef(inputs);
  latestRef.current = inputs;

  useEffect(() => {
    let settling: ReturnType<typeof setTimeout> | undefined;
    let settle: (() => void) | undefined;
    const editSettled = (
      label: string,
      updater: (effects: SessionEffect[]) => SessionEffect[],
    ) => {
      const { editEffects } = latestRef.current;
      editEffects(label, updater, "transient");
      clearTimeout(settling);
      settle = () => {
        settle = undefined;
        latestRef.current.editEffects(label, (effects) => effects);
      };
      settling = setTimeout(settle, SETTLE_MS);
    };

    const stopListening = hub.listen({
      message(input, message) {
        const action =
          input.mapping && deviceControlAction(input.mapping, message);
        if (!action) {
          return;
        }
        const { role, move } = action;
        const latest = latestRef.current;
        if (role.kind === "master-volume") {
          latest.setPreviewVolume(movePosition(latest.previewVolume, move));
        } else if (role.kind === "track-volume") {
          const trackId = latest.sourceTrackIds[role.index];
          if (trackId !== undefined) {
            editSettled(effectHistoryLabels.parameter("Gain", "Gain"), (effects) =>
              moveTrackVolume(effects, trackId, move),
            );
          }
        } else {
          const { selectedEffectId: id } = latest;
          const effect = latest.effects.find((item) => item.id === id);
          const parameter = effect && knobParameters(effect)[role.index];
          if (effect && parameter) {
            editSettled(
              effectHistoryLabels.parameter(effect.effectName, parameter.key),
              (effects) => moveEffectKnob(effects, id, role.index, move),
            );
          }
        }
      },
      disconnected() {},
    });
    return () => {
      stopListening();
      clearTimeout(settling);
      settle?.();
    };
  }, [hub]);
}
