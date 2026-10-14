import { getParameterFormat } from "../../../fx-chain";
import { Fader } from "../../ui/Fader";
import { Knob } from "../../ui/Knob";
import type { FxParameterControlProps } from "../types";
import { useLiveKnob } from "../use-live-knob";
import { ColorWheelControl } from "./ColorWheelControl";
import { ToggleControl } from "./ToggleControl";

export function NumberControl(props: FxParameterControlProps) {
  const { parameter } = props;
  if (parameter.control === "toggle") {
    return <ToggleControl {...props} />;
  }
  if (parameter.control === "wheel") {
    return <ColorWheelControl {...props} />;
  }
  return <LiveNumberControl {...props} />;
}

// A knob or fader, showing where Animation or Modulation moves it.
function LiveNumberControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const live = useLiveKnob(device, parameter.key);
  const defaultValue =
    typeof parameter.defaultValue === "number" ? parameter.defaultValue : 0;
  const shared = {
    accent: device.accent,
    defaultValue,
    format: getParameterFormat(device.effectName, parameter.key),
    label: parameter.label,
    live,
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
    <Knob
      {...shared}
      bipolar={parameter.min < 0 && parameter.max > 0}
      taper={parameter.taper}
    />
  );
}
