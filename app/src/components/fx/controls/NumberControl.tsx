import { getParameterFormat } from "../../../fx-chain";
import { Knob } from "../../ui/Knob";
import type { FxParameterControlProps } from "../types";

export function NumberControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const defaultValue =
    typeof parameter.defaultValue === "number" ? parameter.defaultValue : 0;
  return (
    <Knob
      accent={device.accent}
      bipolar={parameter.min < 0 && parameter.max > 0}
      defaultValue={defaultValue}
      format={getParameterFormat(device.effectName, parameter.key)}
      label={parameter.label}
      max={parameter.max}
      min={parameter.min}
      onChange={(value) =>
        onSetParameter(device, parameter.key, value, "transient")
      }
      onCommit={(value) =>
        onSetParameter(device, parameter.key, value, "commit")
      }
      step={parameter.step}
      value={parameter.numericValue ?? defaultValue}
    />
  );
}
