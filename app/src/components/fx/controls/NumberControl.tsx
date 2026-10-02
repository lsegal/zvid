import { getParameterFormat } from "../../../fx-chain";
import { Fader } from "../../ui/Fader";
import { Knob } from "../../ui/Knob";
import type { FxParameterControlProps } from "../types";
import { ToggleControl } from "./ToggleControl";

export function NumberControl(props: FxParameterControlProps) {
  const { device, parameter, onSetParameter } = props;
  if (parameter.control === "toggle") {
    return <ToggleControl {...props} />;
  }

  const defaultValue =
    typeof parameter.defaultValue === "number" ? parameter.defaultValue : 0;
  const shared = {
    accent: device.accent,
    defaultValue,
    format: getParameterFormat(device.effectName, parameter.key),
    label: parameter.label,
    max: parameter.max,
    min: parameter.min,
    onChange: (value: number) =>
      onSetParameter(device, parameter.key, value, "transient"),
    onCommit: (value: number) =>
      onSetParameter(device, parameter.key, value, "commit"),
    step: parameter.step,
    value: parameter.numericValue ?? defaultValue,
  };
  return parameter.control === "fader" ? (
    <Fader {...shared} ticks={parameter.ticks} />
  ) : (
    <Knob {...shared} bipolar={parameter.min < 0 && parameter.max > 0} />
  );
}
