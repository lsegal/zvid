import { ChevronDownIcon } from "@heroicons/react/24/solid";
import type { useFxEditing } from "../hooks/useFxEditing.ts";
import type { useFxPanelModel } from "../hooks/useFxPanelModel.ts";
import type { SourceClipPropertiesModel } from "../hooks/useSourceClipProperties.ts";
import { FxChain } from "./FxChain";
import { SourceClipProperties } from "./SourceClipProperties";
import { TrackRecordDevice } from "./TrackRecordDevice";
import "./fx-panel.css";

type FxPanelModel = ReturnType<typeof useFxPanelModel>;
type FxEditing = ReturnType<typeof useFxEditing>;

export type FxPanelProps = Pick<
  FxPanelModel,
  | "fxClipLayerOptions"
  | "fxClipScope"
  | "fxClipTrackId"
  | "fxDevices"
  | "fxKind"
  | "fxLaneId"
  | "fxLayerFxEnabled"
  | "fxLayerLabel"
  | "fxLayerName"
  | "fxLayerTrackId"
  | "fxPanelTitle"
  | "fxRecordTrack"
  | "fxSourceTrackId"
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
    | "setFxDeviceModulation"
    | "setFxDeviceModulationEnabled"
    | "setFxDeviceEnabled"
    | "setFxDeviceParameter"
    | "setLayerFxEnabled"
    | "setSourceTrackFxEnabled"
  > & {
    isInspectorCollapsed: boolean;
    toggleInspectorCollapsed: () => void;
    // The selected source clip's properties, shown ahead of the FX chain.
    sourceClip: SourceClipPropertiesModel | null;
  };

// The collapsible FX panel under the editor: its header toggle, the title
// for the selected layer or clip, and the FX chain, led by the selected
// source clip's properties when one is selected. A source track's section
// opens with its Record device.
export function FxPanel({
  addFxDevice,
  duplicateFxDevice,
  fxClipLayerOptions,
  fxClipScope,
  fxClipTrackId,
  fxDevices,
  fxKind,
  fxLaneId,
  fxLayerFxEnabled,
  fxLayerLabel,
  fxLayerName,
  fxLayerTrackId,
  fxPanelTitle,
  fxRecordTrack,
  fxSourceTrackId,
  isInspectorCollapsed,
  moveFxDevice,
  orderLayerOptions,
  removeFxDevice,
  resetFxDevice,
  setFxDeviceAnimation,
  setFxDeviceAnimationEnabled,
  setFxDeviceModulation,
  setFxDeviceModulationEnabled,
  setFxDeviceEnabled,
  setFxDeviceParameter,
  setLayerFxEnabled,
  setSourceTrackFxEnabled,
  sourceClip,
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
          leading={
            sourceClip ? <SourceClipProperties model={sourceClip} /> : null
          }
          layerLeading={
            fxRecordTrack ? (
              <TrackRecordDevice
                key={fxRecordTrack.trackId}
                trackId={fxRecordTrack.trackId}
                trackName={fxRecordTrack.trackName}
              />
            ) : null
          }
          devices={fxDevices}
          kind={fxKind}
          layerFxEnabled={fxLayerFxEnabled}
          layers={orderLayerOptions}
          clipLayers={fxClipLayerOptions}
          layerLabel={fxLayerLabel}
          layerName={fxLayerName}
          layerTrackId={fxLayerTrackId}
          clipTrackId={fxClipTrackId}
          clipScope={fxClipScope}
          onAdd={addFxDevice}
          onDuplicate={duplicateFxDevice}
          onMove={moveFxDevice}
          onRemove={removeFxDevice}
          onReset={resetFxDevice}
          onSetLayerFxEnabled={(enabled) => {
            if (fxSourceTrackId) {
              setSourceTrackFxEnabled(fxSourceTrackId, enabled);
            } else if (fxLaneId) {
              setLayerFxEnabled(fxLaneId, enabled);
            }
          }}
          onSetEnabled={setFxDeviceEnabled}
          onSetAnimationEnabled={setFxDeviceAnimationEnabled}
          onSetAnimation={setFxDeviceAnimation}
          onSetModulationEnabled={setFxDeviceModulationEnabled}
          onSetModulation={setFxDeviceModulation}
          onSetParameter={setFxDeviceParameter}
        />
      </div>
    </section>
  );
}
