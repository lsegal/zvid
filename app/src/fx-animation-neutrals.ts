// Where Clip mode animates each effect's knobs from and back to. Kept apart
// from the Animation defaults (fx-animation-defaults.ts) so both stay
// within the file size budget.

import { MOVE_EFFECT_NAME } from "./composition-transform.ts";
import { COLOR_EFFECT_NAME } from "./fill-paint.ts";
import {
  LEVELS_EFFECT_NAME,
  WHEEL_CHANNELS,
  WHEELS,
  wheelKey,
} from "./fx/effects/levels/levels.ts";
import {
  MOVE_WAYPOINT_LIMIT,
  moveWaypointPrefix,
} from "./fx/effects/move/move.ts";
import { OPACITY_EFFECT_NAME } from "./fx/effects/opacity/opacity.ts";
import {
  DRAWN_KEY,
  OFFSET_KEY,
  SHAPE_EFFECT_NAME,
} from "./fx/effects/shape/shape.ts";
import { TEXT_EFFECT_NAME } from "./text-style.ts";

// Where Clip mode animates a knob from: the value at which it has no visible
// effect. The effect fades in from it on a clip's enter and back to it on
// its exit.
export type AnimationNeutralValue = { neutral: number };

const TRANSFORM_NEUTRALS = {
  PositionX: { neutral: 0 },
  PositionY: { neutral: 0 },
  ScaleX: { neutral: 1 },
  ScaleY: { neutral: 1 },
  Rotation: { neutral: 0 },
} satisfies Record<string, AnimationNeutralValue>;

function prefixed(
  prefix: string,
  neutrals: Record<string, AnimationNeutralValue>,
) {
  return Object.fromEntries(
    Object.entries(neutrals).map(([key, value]) => [`${prefix}${key}`, value]),
  );
}

type AnimationNeutralValues = Readonly<Record<string, AnimationNeutralValue>>;

const NEUTRAL_VALUES: ReadonlyMap<string, AnimationNeutralValues> = new Map<
  string,
  AnimationNeutralValues
>([
  ["Transform", TRANSFORM_NEUTRALS],
  [
    MOVE_EFFECT_NAME,
    {
      ...prefixed("Start", TRANSFORM_NEUTRALS),
      ...Object.fromEntries(
        Array.from({ length: MOVE_WAYPOINT_LIMIT }, (_, index) =>
          Object.entries(
            prefixed(moveWaypointPrefix(index + 1), TRANSFORM_NEUTRALS),
          ),
        ).flat(),
      ),
      ...prefixed("End", TRANSFORM_NEUTRALS),
    },
  ],
  // A zoom of 0 is 1.00×, centered.
  [
    "ZoomAndPan",
    {
      _Start_Zoom: { neutral: 0 },
      _Start_X: { neutral: 0.5 },
      _Start_Y: { neutral: 0.5 },
      _End_Zoom: { neutral: 0 },
      _End_X: { neutral: 0.5 },
      _End_Y: { neutral: 0.5 },
    },
  ],
  ["Colorize", { _HueOffset: { neutral: 0 } }],
  // An outline enters drawn from nothing, its dashes marching into place.
  [
    SHAPE_EFFECT_NAME,
    { [DRAWN_KEY]: { neutral: 0 }, [OFFSET_KEY]: { neutral: 0 } },
  ],
  // 0 stops leaves the light as it is.
  ["Exposure", { _Stops: { neutral: 0 } }],
  // Contrast 1 leaves the picture as it is, whatever the Pivot.
  ["Contrast", { _Contrast: { neutral: 1 } }],
  // Intensity 0 leaves the picture as it is.
  ["LUT", { _Intensity: { neutral: 0 } }],
  [
    "Pixelate",
    {
      _NumPixels: { neutral: 0 },
      _LowIntensity: { neutral: 0 },
      _HighIntensity: { neutral: 0 },
    },
  ],
  [
    "NegativeSplit",
    { _LowIntensity: { neutral: 0 }, _HighIntensity: { neutral: 0 } },
  ],
  ["AnalogGlitch", { _LowMod: { neutral: 0 }, _HighMod: { neutral: 0 } }],
  ["Distortion", { _Amount: { neutral: 0 } }],
  // Intensity 0 with Warp 0 leaves the layer as it is.
  ["Caustics", { _Intensity: { neutral: 0 }, _Warp: { neutral: 0 } }],
  // Amount 0 sees straight through the surface.
  ["Refraction", { _Amount: { neutral: 0 } }],
  // Amount 0 leaves the frame untouched.
  [
    "DigitalGlitch",
    {
      _Amount: { neutral: 0 },
      _Displace: { neutral: 0 },
      _ChannelShift: { neutral: 0 },
    },
  ],
  // Intensity 0 adds no glow.
  ["Bloom", { _Intensity: { neutral: 0 } }],
  // Radius 0 leaves the picture sharp.
  ["GaussianBlur", { _Radius: { neutral: 0 } }],
  // Distance 0 leaves the picture sharp.
  ["MotionBlur", { _Distance: { neutral: 0 } }],
  // Each wheel at its default leaves the levels as they are; the curves
  // aren't numbers, so they stay.
  [
    LEVELS_EFFECT_NAME,
    Object.fromEntries(
      WHEELS.flatMap((wheel) =>
        WHEEL_CHANNELS.map((channel) => [
          wheelKey(wheel.name, channel),
          { neutral: wheel.defaultValue },
        ]),
      ),
    ),
  ],
  [COLOR_EFFECT_NAME, { Opacity: { neutral: 0 } }],
  [OPACITY_EFFECT_NAME, { Opacity: { neutral: 0 } }],
  // Text has no opacity knob: Clip mode fades its colors instead.
  [TEXT_EFFECT_NAME, {}],
]);

// The knobs Clip mode animates for the effect, keyed by parameter, and each
// one's neutral value.
export function getAnimationNeutralValues(
  effectName: string,
): AnimationNeutralValues {
  return NEUTRAL_VALUES.get(effectName) ?? {};
}
