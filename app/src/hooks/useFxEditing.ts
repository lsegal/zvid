import { useCallback } from "react";
import { patchProjectState } from "../app/session-project.ts";
import type {
  ArrangementClip,
  Lane,
  ProjectState,
  SourceTrack,
} from "../app/types.ts";
import type { FxEditMode } from "../components/FxChain";
import type { EffectAnimation } from "../fx-animation-defaults";
import { isFxClip } from "../fx-clip.ts";
import type { EffectModulation } from "../fx-modulation-defaults";
import { isShapeEffectName } from "../fx/effects/shape/shape.ts";
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
  setEffectModulation,
  setEffectModulationEnabled,
  setEffectParameter,
  setLaneFxEnabled,
} from "../fx-stack";
import { addShapeTransform } from "../preview-edit.ts";
import type { ProjectHistoryAction } from "../project-history";

export type FxEditingInputs = {
  dispatchProject: (action: ProjectHistoryAction<ProjectState>) => void;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  lanes: Lane[];
  sourceTracks: SourceTrack[];
  timelineClipsRef: { current: ArrangementClip[] };
};

// The FX chain's edits to layer and clip effect stacks.
export function useFxEditing({
  dispatchProject,
  commitProjectChange,
  lanes,
  sourceTracks,
  timelineClipsRef,
}: FxEditingInputs) {
  // Applies an effect-stack edit. Live gestures such as slider drags send
  // `transient` updates, and the `commit` that ends the gesture records the
  // whole gesture as one history entry.
  const editEffects = useCallback(
    (
      label: string,
      updater: (
        effects: SessionEffect[],
        project: ProjectState,
      ) => SessionEffect[],
      mode: "commit" | "transient" = "commit",
    ) => {
      const projectUpdater = (current: ProjectState) =>
        patchProjectState(current, {
          effects: updater(current.effects, current),
        });
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

  // A source track's FX switch, like a layer's. It is not a source track
  // edit the lock refuses, so it works while the source tracks are locked.
  const setSourceTrackFxEnabled = useCallback(
    (trackId: string, enabled: boolean) => {
      commitProjectChange(
        effectHistoryLabels.layerFx(
          sourceTracks.find((track) => track.id === trackId)?.name ??
            `Source ${trackId}`,
          enabled,
        ),
        (current) =>
          patchProjectState(current, {
            sourceTracks: setLaneFxEnabled(
              current.sourceTracks,
              trackId,
              enabled,
            ),
          }),
      );
    },
    [commitProjectChange, sourceTracks],
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
      editEffects(effectHistoryLabels.add(effectName), (current, project) => {
        const added = addEffect(
          current,
          trackId,
          effectName,
          undefined,
          id,
          scope,
        );
        // A Shape on a layer without a Transform starts as a centered
        // square rather than stretched over the whole canvas.
        return added !== current && isShapeEffectName(effectName)
          ? addShapeTransform(
              added,
              trackId,
              { width: project.canvasWidth, height: project.canvasHeight },
              crypto.randomUUID(),
            )
          : added;
      });
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

  const setFxDeviceModulationEnabled = useCallback(
    (device: FxDevice, enabled: boolean) =>
      editEffects(
        effectHistoryLabels.modulationEnabled(device.effectName, enabled),
        (current) => setEffectModulationEnabled(current, device.id, enabled),
      ),
    [editEffects],
  );

  const setFxDeviceModulation = useCallback(
    (device: FxDevice, modulation: EffectModulation, mode: FxEditMode) =>
      editEffects(
        effectHistoryLabels.modulation(device.effectName),
        (current) => setEffectModulation(current, device.id, modulation),
        mode,
      ),
    [editEffects],
  );

  return {
    editEffects,
    setLayerFxEnabled,
    setSourceTrackFxEnabled,
    setFxDeviceEnabled,
    setFxDeviceParameter,
    setFxDeviceAnimationEnabled,
    setFxDeviceAnimation,
    setFxDeviceModulationEnabled,
    setFxDeviceModulation,
    moveFxDevice,
    addFxDevice,
    removeFxDevice,
    resetFxDevice,
    duplicateFxDevice,
  };
}
