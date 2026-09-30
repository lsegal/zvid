import type { FxLayerOption } from "../../fx-chain";
import type { FxDevice, FxDeviceParameter } from "../../fx-stack";

export type FxEditMode = "commit" | "transient";

export type FxSetParameter = (
  device: FxDevice,
  key: string,
  value: number | string,
  mode: FxEditMode,
) => void;

// Props every parameter control receives from FxParameterControl.
export type FxParameterControlProps = {
  device: FxDevice;
  parameter: FxDeviceParameter;
  layers: readonly FxLayerOption[];
  onSetParameter: FxSetParameter;
};
