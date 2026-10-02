import type { FxParameterControlProps } from "../types";
import "./toggle-control.css";

// An on/off number parameter, such as Gain's Mute, as a button that reads
// pressed while on, like the device's power button.
export function ToggleControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const on = (parameter.numericValue ?? 0) >= 0.5;
  return (
    <div className="fx-toggle">
      <button
        aria-label={`${parameter.label} ${device.name}`}
        aria-pressed={on}
        className="fx-toggle__button"
        onClick={() =>
          onSetParameter(device, parameter.key, on ? 0 : 1, "commit")
        }
        title={`${parameter.label} ${on ? "on" : "off"}`}
        type="button"
      >
        {parameter.label}
      </button>
    </div>
  );
}
