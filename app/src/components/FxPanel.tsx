import { ChevronDownIcon } from "@heroicons/react/24/solid";
import { type CSSProperties, type ReactNode, useRef } from "react";
import { FX_PANEL_MIN_HEIGHT } from "../app/constants.ts";
import { SOURCE_CLIP_COLLAPSE_KEY } from "../fx-chain.ts";
import { useFxDeviceMaxHeight } from "../hooks/useFxDeviceMaxHeight.ts";
import type { useFxEditing } from "../hooks/useFxEditing.ts";
import type { useFxPanelModel } from "../hooks/useFxPanelModel.ts";
import type { FxPanelResize } from "../hooks/useFxPanelResize.ts";
import type { SourceClipPropertiesModel } from "../hooks/useSourceClipProperties.ts";
import { FxChain } from "./FxChain";
import { InheritedSourceFx } from "./fx/InheritedSourceFx";
import {
  INACTIVE_KEY_MAP,
  KeyMapContext,
  type KeyMapControls,
  MidiMapContext,
} from "./fx/key-map-context";
import { FxMidiOnsetsContext } from "./fx/modulation-clock";
import { FxDeviceMaxHeightContext } from "./fx/use-device-fit";
import { MidiDevices } from "./midi/MidiDevices";
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
  | "fxInheritedSource"
  | "fxKind"
  | "fxLaneId"
  | "fxLayerFxEnabled"
  | "fxLayerLabel"
  | "fxLayerName"
  | "fxLayerTrackId"
  | "fxPanelTitle"
  | "fxRecordTrack"
  | "fxSourceTrackId"
  | "fxMidiClip"
  | "orderLayerOptions"
  | "selectedFxDevice"
  | "selectFxDevice"
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
    | "setMidiClipNotes"
    | "setMidiClipTimeline"
  > & {
    isInspectorCollapsed: boolean;
    toggleInspectorCollapsed: () => void;
    // The handle on the panel's top edge; the phone's sheet has its own drag.
    fxPanelResize?: FxPanelResize;
    // The selected source clip's properties, shown ahead of the FX chain.
    sourceClip: SourceClipPropertiesModel | null;
    // The mobile shell's sheet header, which replaces the toggle there.
    sheetHeader?: ReactNode;
    // Mapping mode, which marks the devices' mappable buttons.
    keyMap?: KeyMapControls;
    midiMap?: Pick<KeyMapControls, "active" | "toggle">;
  };

// The collapsible, resizable FX panel under the editor: its header toggle, the title
// for the selected layer or clip, and the FX chain. A source track's Record
// device leads the chain, ahead of the selected source clip's properties,
// even though it belongs to the track. A selected MIDI clip adds its piano
// roll after those; its Synth and Arpeggiator are effects on its own stack.
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
  fxInheritedSource,
  fxKind,
  fxLaneId,
  fxLayerFxEnabled,
  fxLayerLabel,
  fxLayerName,
  fxLayerTrackId,
  fxPanelResize,
  fxPanelTitle,
  fxRecordTrack,
  fxSourceTrackId,
  fxMidiClip,
  isInspectorCollapsed,
  keyMap = INACTIVE_KEY_MAP,
  midiMap = INACTIVE_KEY_MAP,
  moveFxDevice,
  moveFxDeviceToStack,
  orderLayerOptions,
  pasteFxDevice,
  removeFxDevice,
  resetFxDevice,
  selectedFxDevice,
  selectFxDevice,
  setFxDeviceAnimation,
  setFxDeviceAnimationEnabled,
  setFxDeviceModulation,
  setFxDeviceModulationEnabled,
  setFxDeviceEnabled,
  setFxDeviceParameter,
  setLayerFxEnabled,
  setSourceTrackFxEnabled,
  setMidiClipNotes,
  setMidiClipTimeline,
  sheetHeader,
  sourceClip,
  toggleInspectorCollapsed,
}: FxPanelProps) {
  const { height: fxPanelHeight, ...resizeHandlers } = fxPanelResize ?? {};
  const bodyRef = useRef<HTMLDivElement>(null);
  const deviceMaxHeight = useFxDeviceMaxHeight(
    bodyRef,
    fxPanelResize !== undefined,
    fxPanelHeight ?? null,
    isInspectorCollapsed,
  );
  return (
    <FxMidiOnsetsContext.Provider value={fxMidiClip?.reactiveOnsets}>
      {fxPanelResize && !isInspectorCollapsed ? (
        <hr
          className="fx-panel-resize-handle"
          aria-label="Resize effects panel"
          aria-valuenow={fxPanelHeight ?? undefined}
          aria-valuemin={FX_PANEL_MIN_HEIGHT}
          tabIndex={0}
          title="Drag to resize. Double-click to fit the contents."
          {...resizeHandlers}
        />
      ) : null}
      <section
        className={`fx-panel ${isInspectorCollapsed ? "fx-panel--collapsed" : ""}`}
      >
        {sheetHeader}
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
          ref={bodyRef}
          style={
            deviceMaxHeight === null
              ? undefined
              : ({
                  "--fx-device-max-height": `${deviceMaxHeight}px`,
                } as CSSProperties)
          }
        >
          <FxDeviceMaxHeightContext.Provider value={deviceMaxHeight}>
            <KeyMapContext.Provider value={keyMap}>
              <MidiMapContext.Provider value={midiMap}>
                <FxChain
                  leading={(collapse) => (
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
                          collapsed={collapse.collapsed.has(
                            SOURCE_CLIP_COLLAPSE_KEY,
                          )}
                          midiClip={
                            fxMidiClip?.spanId === sourceClip.spanId
                              ? fxMidiClip
                              : undefined
                          }
                          model={sourceClip}
                          onSetMidiTimeline={setMidiClipTimeline}
                          onToggleCollapsed={() =>
                            collapse.toggleCollapsed(SOURCE_CLIP_COLLAPSE_KEY)
                          }
                        />
                      ) : null}
                      <MidiDevices
                        {...collapse}
                        midiClip={fxMidiClip}
                        setNotes={setMidiClipNotes}
                        setTimeline={setMidiClipTimeline}
                      />
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
                  clipLeading={
                    fxInheritedSource ? (
                      <InheritedSourceFx stacks={fxInheritedSource} />
                    ) : null
                  }
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
                  selectedDeviceId={selectedFxDevice?.id}
                  onSelectDevice={selectFxDevice}
                />
              </MidiMapContext.Provider>
            </KeyMapContext.Provider>
          </FxDeviceMaxHeightContext.Provider>
        </div>
      </section>
    </FxMidiOnsetsContext.Provider>
  );
}
