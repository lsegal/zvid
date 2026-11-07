import { useEffect, useRef } from "react";
import { effectHistoryLabels, type SessionEffect } from "../fx-stack.ts";
import {
  knobParameters,
  moveEffectKnob,
  movePosition,
  moveTrackVolume,
} from "../midi-device-targets.ts";
import {
  ccMoveReader,
  deviceControlAction,
} from "../midi-input/device-controls.ts";
import { type MidiInputHub, midiInputHub } from "../midi-input/input-hub.ts";
import { settledEffectEdits } from "./settled-effect-edits.ts";
import type { useFxEditing } from "./useFxEditing.ts";

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
    const { edit: editSettled, flush } = settledEffectEdits((...args) =>
      latestRef.current.editEffects(...args),
    );

    // Each device's CCs, read in order to tell its encoders from its knobs.
    const ccReaders = new Map<string, ReturnType<typeof ccMoveReader>>();

    const stopListening = hub.listen({
      message(input, message) {
        let readCc = ccReaders.get(input.id);
        if (!readCc) {
          readCc = ccMoveReader();
          ccReaders.set(input.id, readCc);
        }
        const action =
          input.mapping && deviceControlAction(input.mapping, message, readCc);
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
            editSettled(
              effectHistoryLabels.parameter("Gain", "Gain"),
              (effects) => moveTrackVolume(effects, trackId, move),
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
      flush();
    };
  }, [hub]);
}
