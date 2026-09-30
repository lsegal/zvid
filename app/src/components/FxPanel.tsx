import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { clipEffectTrackId, isLayerFxEnabled } from "../fx-stack";
import type { useFxEditing } from "../hooks/useFxEditing.ts";
import type { useFxPanelModel } from "../hooks/useFxPanelModel.ts";
import { FxChain } from "./FxChain";

type FxPanelModel = ReturnType<typeof useFxPanelModel>;
type FxEditing = ReturnType<typeof useFxEditing>;

export type FxPanelProps = Pick<
  FxPanelModel,
  | "fxClipId"
  | "fxClipLayerOptions"
  | "fxClipScope"
  | "fxDevices"
  | "fxKind"
  | "fxLane"
  | "fxLaneId"
  | "fxPanelTitle"
  | "orderLayerOptions"
> &
  Pick<
    FxEditing,
    | "addFxDevice"
    | "duplicateFxDevice"
    | "moveFxDevice"
    | "removeFxDevice"
    | "resetFxDevice"
    | "setFxDeviceAnimation"
    | "setFxDeviceAnimationEnabled"
    | "setFxDeviceEnabled"
    | "setFxDeviceParameter"
    | "setLayerFxEnabled"
  > & {
    isInspectorCollapsed: boolean;
    toggleInspectorCollapsed: () => void;
  };

// The collapsible FX panel under the editor: its header toggle, the title
// for the selected layer or clip, and the FX chain.
export function FxPanel({
  addFxDevice,
  duplicateFxDevice,
  fxClipId,
  fxClipLayerOptions,
  fxClipScope,
  fxDevices,
  fxKind,
  fxLane,
  fxLaneId,
  fxPanelTitle,
  isInspectorCollapsed,
  moveFxDevice,
  orderLayerOptions,
  removeFxDevice,
  resetFxDevice,
  setFxDeviceAnimation,
  setFxDeviceAnimationEnabled,
  setFxDeviceEnabled,
  setFxDeviceParameter,
  setLayerFxEnabled,
  toggleInspectorCollapsed,
}: FxPanelProps) {
  return (
    <section
      className={`fx-panel ${isInspectorCollapsed ? "fx-panel--collapsed" : ""}`}
    >
      <button
        aria-controls="fx-panel-body"
        aria-expanded={!isInspectorCollapsed}
        className="fx-panel__toggle"
        onClick={toggleInspectorCollapsed}
        type="button"
      >
        <span>{fxPanelTitle}</span>
        <ChevronDownIcon aria-hidden="true" />
      </button>

      <div
        className="fx-panel__body"
        hidden={isInspectorCollapsed}
        id="fx-panel-body"
      >
        <FxChain
          devices={fxDevices}
          kind={fxKind}
          layerFxEnabled={isLayerFxEnabled(fxLane)}
          layers={orderLayerOptions}
          clipLayers={fxClipLayerOptions}
          layerName={fxLane?.name}
          layerTrackId={fxLaneId}
          clipTrackId={fxClipId ? clipEffectTrackId(fxClipId) : undefined}
          clipScope={fxClipScope}
          onAdd={addFxDevice}
          onDuplicate={duplicateFxDevice}
          onMove={moveFxDevice}
          onRemove={removeFxDevice}
          onReset={resetFxDevice}
          onSetLayerFxEnabled={(enabled) => {
            if (fxLaneId) {
              setLayerFxEnabled(fxLaneId, enabled);
            }
          }}
          onSetEnabled={setFxDeviceEnabled}
          onSetAnimationEnabled={setFxDeviceAnimationEnabled}
          onSetAnimation={setFxDeviceAnimation}
          onSetParameter={setFxDeviceParameter}
        />
      </div>
    </section>
  );
}
