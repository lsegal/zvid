// Levels' color wheels: Lift, Gamma, Gain and Offset, each a master number
// (Y) and a number for each of red, green and blue. The grading they make,
// written in TypeScript for tests; pass.ts runs the same in GLSL.

import type { FxWheelChannel } from "../../types.ts";

export const LEVELS_EFFECT_NAME = "Levels";

export const CURVE_KEY = "Curve";

export type WheelName = "Lift" | "Gamma" | "Gain" | "Offset";

export type WheelDefinition = {
  name: WheelName;
  min: number;
  max: number;
  defaultValue: number;
  // How a channel combines with the master: Gain multiplies by it, the
  // others add it.
  master: "add" | "multiply";
  // How far the puck at the wheel's edge moves a channel from the mean.
  reach: number;
  description: string;
};

export const WHEELS: readonly WheelDefinition[] = [
  {
    name: "Lift",
    min: -1,
    max: 1,
    defaultValue: 0,
    master: "add",
    reach: 0.25,
    description: "Raises or lowers the blacks, leaving the whites",
  },
  {
    name: "Gamma",
    min: -1,
    max: 1,
    defaultValue: 0,
    master: "add",
    reach: 0.5,
    description: "Brightens or darkens the midtones",
  },
  {
    name: "Gain",
    min: 0,
    max: 4,
    defaultValue: 1,
    master: "multiply",
    reach: 0.5,
    description: "Scales the whites, leaving the blacks",
  },
  {
    name: "Offset",
    min: -1,
    max: 1,
    defaultValue: 0,
    master: "add",
    reach: 0.25,
    description: "Shifts every level",
  },
];

export const WHEEL_CHANNELS: readonly FxWheelChannel["channel"][] = [
  "y",
  "r",
  "g",
  "b",
];

const CHANNEL_SUFFIX: Record<FxWheelChannel["channel"], string> = {
  y: "Y",
  r: "R",
  g: "G",
  b: "B",
};

// The stored key of a wheel's channel, such as `GainR`.
export function wheelKey(wheel: WheelName, channel: FxWheelChannel["channel"]) {
  return `${wheel}${CHANNEL_SUFFIX[channel]}`;
}

export type WheelValues = Readonly<Record<FxWheelChannel["channel"], number>>;

// The wheel's value for red, green and blue: each channel with the master.
export function effectiveWheel(
  wheel: WheelDefinition,
  values: WheelValues,
): [number, number, number] {
  const combine = (channel: number) =>
    wheel.master === "multiply" ? channel * values.y : channel + values.y;
  return [combine(values.r), combine(values.g), combine(values.b)];
}

export type LevelsGrade = Readonly<
  Record<"lift" | "gamma" | "gain" | "offset", readonly number[]>
>;

export const IDENTITY_GRADE: LevelsGrade = {
  lift: [0, 0, 0],
  gamma: [0, 0, 0],
  gain: [1, 1, 1],
  offset: [0, 0, 0],
};

export function isIdentityGrade(grade: LevelsGrade) {
  return (["lift", "gamma", "gain", "offset"] as const).every((name) =>
    grade[name].every((value, index) => value === IDENTITY_GRADE[name][index]),
  );
}

// One channel's level graded by its wheels, before the curves: Offset shifts
// it, Lift and Gain map 0 to Lift and 1 to Gain, and Gamma bends the result
// by a power of 2^-Gamma, so a positive Gamma brightens the midtones.
export function gradeLevel(
  level: number,
  lift: number,
  gamma: number,
  gain: number,
  offset: number,
) {
  const shifted = level + offset;
  const mapped = Math.max(0, Math.min(1, lift + shifted * (gain - lift)));
  return mapped ** (2 ** -gamma);
}

// Where each of red, green and blue points in a wheel, x right and y down:
// red at the top, green a third of a turn clockwise and blue two thirds.
const HUE_DIRECTIONS = [0, 1, 2].map((index) => {
  const angle = (index * 2 * Math.PI) / 3;
  return [Math.sin(angle), -Math.cos(angle)] as const;
});

// The puck's position in the wheel, within the unit disc at `reach`, for
// the color channels `rgb`: their spread from their mean.
export function puckPosition(
  rgb: readonly [number, number, number],
  reach: number,
): [number, number] {
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  let x = 0;
  let y = 0;
  for (const [index, [dx, dy]] of HUE_DIRECTIONS.entries()) {
    const spread = (rgb[index] - mean) / reach;
    x += (2 / 3) * spread * dx;
    y += (2 / 3) * spread * dy;
  }
  return [x, y];
}

// The color channels for the puck at `[x, y]`, clamped to the unit disc,
// keeping the channels' mean.
export function puckChannels(
  position: readonly [number, number],
  mean: number,
  reach: number,
): [number, number, number] {
  const length = Math.hypot(position[0], position[1]);
  const scale = length > 1 ? 1 / length : 1;
  const x = position[0] * scale;
  const y = position[1] * scale;
  const [red, green, blue] = HUE_DIRECTIONS.map(
    ([dx, dy]) => mean + reach * (x * dx + y * dy),
  );
  return [red, green, blue];
}
