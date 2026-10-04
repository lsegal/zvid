import type { ComponentType } from "react";
import type { FxDeviceParameter } from "../../../fx-stack";
import type { FxParameterControlProps } from "../types";
import { EnumControl } from "./EnumControl";
import { FlagsControl } from "./FlagsControl";
import { FontControl } from "./FontControl";
import { LayersControl } from "./LayersControl";
import { NumberControl } from "./NumberControl";
import { PaintControl } from "./PaintControl";
import { ShapeControl } from "./ShapeControl";
import { TextControl } from "./TextControl";

// The control each parameter kind renders with. A new kind adds its control
// file and one entry here.
export const PARAMETER_CONTROLS: Record<
  FxDeviceParameter["kind"],
  ComponentType<FxParameterControlProps>
> = {
  number: NumberControl,
  enum: EnumControl,
  color: PaintControl,
  gradient: PaintControl,
  text: TextControl,
  font: FontControl,
  flags: FlagsControl,
  layers: LayersControl,
  shape: ShapeControl,
};
