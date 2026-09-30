import { useCallback } from "react";
import { patchProjectState } from "../app/session-project.ts";
import type { ArrangementClip, Lane, ProjectState } from "../app/types.ts";
import type { FxEditMode } from "../components/FxChain";
import type { EffectAnimation } from "../fx-animation-defaults";
import { isFxClip } from "../fx-clip.ts";
import {
  addEffect,
  duplicateEffect,
  effectHistoryLabels,
  type FxDevice,
  getEffectClipId,
  moveEffect,
  removeEffect,
  resetEffect,
  type SessionEffect,
  setEffectAnimation,
  setEffectAnimationEnabled,
  setEffectEnabled,
  setEffectParameter,
  setLaneFxEnabled,
} from "../fx-stack";
import type { ProjectHistoryAction } from "../project-history";

export type FxEditingInputs = {
  dispatchProject: (action: ProjectHistoryAction<ProjectState>) => void;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  lanes: Lane[];
  timelineClipsRef: { current: ArrangementClip[] };
};

// The FX chain's edits to layer and clip effect stacks.
export function useFxEditing({
  dispatchProject,
  commitProjectChange,
  lanes,
  timelineClipsRef,
}: FxEditingInputs) {
  // Applies an effect-stack edit. Live gestures such as slider drags send
  // `transient` updates, and the `commit` that ends the gesture records the
  // whole gesture as one history entry.
  const editEffects = useCallback(
    (
      label: string,
      updater: (effects: SessionEffect[]) => SessionEffect[],
      mode: "commit" | "transient" = "commit",
    ) => {
      const projectUpdater = (current: ProjectState) =>
        patchProjectState(current, { effects: updater(current.effects) });
      dispatchProject(
        mode === "transient"
          ? { type: "transient", updater: projectUpdater }
          : { type: "commit", label, updater: projectUpdater },
      );
    },
    [dispatchProject],
  );

  const setLayerFxEnabled = useCallback(
    (laneId: string, enabled: boolean) => {
      commitProjectChange(
        effectHistoryLabels.layerFx(
          lanes.find((lane) => lane.id === laneId)?.name ?? `Layer ${laneId}`,
          enabled,
        ),
        (current) =>
          patchProjectState(current, {
            lanes: setLaneFxEnabled(current.lanes, laneId, enabled),
          }),
      );
    },
    [commitProjectChange, lanes],
  );

  const setFxDeviceEnabled = useCallback(
    (device: FxDevice, enabled: boolean) =>
      editEffects(
        effectHistoryLabels.enabled(device.effectName, enabled),
        (current) => setEffectEnabled(current, device.id, enabled),
      ),
    [editEffects],
  );

  const setFxDeviceParameter = useCallback(
    (device: FxDevice, key: string, value: number | string, mode: FxEditMode) =>
      editEffects(
        effectHistoryLabels.parameter(device.effectName, key),
        (current) => setEffectParameter(current, device.id, key, value),
        mode,
      ),
    [editEffects],
  );

  const setFxDeviceAnimationEnabled = useCallback(
    (device: FxDevice, enabled: boolean) =>
      editEffects(
        effectHistoryLabels.animationEnabled(device.effectName, enabled),
        (current) => setEffectAnimationEnabled(current, device.id, enabled),
      ),
    [editEffects],
  );

  const setFxDeviceAnimation = useCallback(
    (device: FxDevice, animation: EffectAnimation, mode: FxEditMode) =>
      editEffects(
        effectHistoryLabels.animation(device.effectName),
        (current) => setEffectAnimation(current, device.id, animation),
        mode,
      ),
    [editEffects],
  );

  const moveFxDevice = useCallback(
    (device: FxDevice, toIndex: number) =>
      editEffects(effectHistoryLabels.move(device.effectName), (current) =>
        moveEffect(current, device.id, toIndex),
      ),
    [editEffects],
  );

  const addFxDevice = useCallback(
    (trackId: string, effectName: string, id: string) => {
      // An FX clip's own stack takes the effects that work on a composite,
      // Order among them.
      const clipId = getEffectClipId(trackId);
      const scope =
        clipId !== undefined &&
        isFxClip(timelineClipsRef.current.find((clip) => clip.id === clipId))
          ? "fxClip"
          : undefined;
      editEffects(effectHistoryLabels.add(effectName), (current) =>
        addEffect(current, trackId, effectName, undefined, id, scope),
      );
    },
    [editEffects, timelineClipsRef],
  );

  const removeFxDevice = useCallback(
    (device: FxDevice) =>
      editEffects(effectHistoryLabels.remove(device.effectName), (current) =>
        removeEffect(current, device.id),
      ),
    [editEffects],
  );

  const resetFxDevice = useCallback(
    (device: FxDevice) =>
      editEffects(effectHistoryLabels.reset(device.effectName), (current) =>
        resetEffect(current, device.id),
      ),
    [editEffects],
  );

  const duplicateFxDevice = useCallback(
    (device: FxDevice, id: string) =>
      editEffects(effectHistoryLabels.duplicate(device.effectName), (current) =>
        duplicateEffect(current, device.id, id),
      ),
    [editEffects],
  );

  return {
    editEffects,
    setLayerFxEnabled,
    setFxDeviceEnabled,
    setFxDeviceParameter,
    setFxDeviceAnimationEnabled,
    setFxDeviceAnimation,
    moveFxDevice,
    addFxDevice,
    removeFxDevice,
    resetFxDevice,
    duplicateFxDevice,
  };
}
