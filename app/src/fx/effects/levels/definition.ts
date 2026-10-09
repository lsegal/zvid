import type {
  FxEffectDefinition,
  FxNumberParameterDefinition,
} from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";
import {
  CURVE_KEY,
  LEVELS_EFFECT_NAME,
  WHEEL_CHANNELS,
  WHEELS,
  type WheelDefinition,
  wheelKey,
} from "./levels.ts";

// In the color category, after Contrast.
export const menuOrder = 23;

function formatLevel(value: number) {
  return value.toFixed(2);
}

// A wheel's Y, R, G and B numbers, which its color wheel edits together.
function wheelParameters(wheel: WheelDefinition) {
  return WHEEL_CHANNELS.map(
    (channel): FxNumberParameterDefinition => ({
      kind: "number",
      key: wheelKey(wheel.name, channel),
      label: `${wheel.name} ${channel.toUpperCase()}`,
      min: wheel.min,
      max: wheel.max,
      defaultValue: wheel.defaultValue,
      step: 0.01,
      format: formatLevel,
      control: "wheel",
      wheel: { name: wheel.name, channel, reach: wheel.reach },
    }),
  );
}

export const definition: FxEffectDefinition = {
  effectName: LEVELS_EFFECT_NAME,
  displayName: "Levels",
  description:
    "Grades the picture with Lift, Gamma, Gain and Offset color wheels and a tone curve.",
  accent: "#facc15",
  category: "color",
  known: true,
  scopes: ALL_SCOPES,
  // The four wheels in a row, and the curve beside them.
  knobColumns: WHEELS.length + 1,
  parameters: [
    ...WHEELS.flatMap(wheelParameters),
    {
      kind: "curve",
      key: CURVE_KEY,
      label: "Curve",
      defaultValue: "",
    },
  ],
};
