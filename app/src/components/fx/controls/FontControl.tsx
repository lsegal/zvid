import { FontPicker } from "../../FontPicker";
import type { FxParameterControlProps } from "../types";

export function FontControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  return (
    <FontPicker
      label={parameter.label}
      onChange={(value) =>
        onSetParameter(device, parameter.key, value, "commit")
      }
      value={parameter.stringValue ?? `${parameter.defaultValue}`}
    />
  );
}
