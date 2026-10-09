import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { SOURCE_CLIP_COLLAPSE_KEY } from "../fx-chain.ts";
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
    | "clearFxDevices"
    | "copyFxDevice"
    | "cutFxDevice"
    | "duplicateFxDevice"
    | "fxClipboard"
    | "pasteFxDevice"
    | "moveFxDevice"
    | "moveFxDeviceToStack"
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
// for the selected layer or clip, and the FX chain. A source track's Record
// device leads the chain, ahead of the selected source clip's properties,
// even though it belongs to the track.
export function FxPanel({
  addFxDevice,
  clearFxDevices,
  copyFxDevice,
  cutFxDevice,
  duplicateFxDevice,
  fxClipboard,
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
  moveFxDeviceToStack,
  orderLayerOptions,
  pasteFxDevice,
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
          leading={({ collapsed, toggleCollapsed }) => (
            <>
              {fxRecordTrack ? (
                <TrackRecordDevice
                  key={fxRecordTrack.trackId}
                  trackId={fxRecordTrack.trackId}
                  trackName={fxRecordTrack.trackName}
                />
              ) : null}
              {sourceClip ? (
                <SourceClipProperties
                  collapsed={collapsed.has(SOURCE_CLIP_COLLAPSE_KEY)}
                  model={sourceClip}
                  onToggleCollapsed={() =>
                    toggleCollapsed(SOURCE_CLIP_COLLAPSE_KEY)
                  }
                />
              ) : null}
            </>
          )}
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
          clipboardEffectName={fxClipboard?.effectName}
          onClearAll={clearFxDevices}
          onCopy={copyFxDevice}
          onCut={cutFxDevice}
          onDuplicate={duplicateFxDevice}
          onMove={moveFxDevice}
          onMoveToStack={moveFxDeviceToStack}
          onPaste={pasteFxDevice}
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
