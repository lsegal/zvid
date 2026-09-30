import { PARAMETER_CONTROLS } from "./controls";
import { NumberControl } from "./controls/NumberControl";
import type { FxParameterControlProps } from "./types";

export function FxParameterControl(props: FxParameterControlProps) {
  // A kind with no control of its own falls back to a knob.
  const Control = PARAMETER_CONTROLS[props.parameter.kind] ?? NumberControl;
  return <Control {...props} />;
}
