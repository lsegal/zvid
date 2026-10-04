import { formatPercent } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  DEFAULT_TRANSITION_TYPE,
  TRANSITION_TYPES,
  typesUsing,
} from "./registry.ts";
import {
  COUNT_KEY,
  DEFAULT_COUNT,
  DEFAULT_DIRECTION,
  DEFAULT_IRIS,
  DEFAULT_ORIENTATION,
  DEFAULT_ORIGIN,
  DEFAULT_SOFTNESS,
  DIRECTION_KEY,
  IRIS_KEY,
  MAX_COUNT,
  MIN_COUNT,
  ORIENTATION_KEY,
  ORIGIN_KEY,
  SOFTNESS_KEY,
  TRANSITION_DIRECTIONS,
  TRANSITION_EFFECT_NAME,
  TRANSITION_IRISES,
  TRANSITION_ORIENTATIONS,
  TRANSITION_ORIGINS,
  TYPE_KEY,
} from "./transition.ts";

// Where the effect sits in the add menus, lowest first: after Order.
export const menuOrder = 95;

export const definition: FxEffectDefinition = {
  effectName: TRANSITION_EFFECT_NAME,
  displayName: "Transition",
  description:
    "Transitions from what is beneath the FX clip at its start to what is beneath it at its end.",
  accent: "#7fb8ff",
  category: "transform",
  known: true,
  // It blends between the comps beneath an FX clip, so it has nothing to
  // work on anywhere else.
  scopes: ["fxClip"],
  parameters: [
    {
      kind: "enum",
      key: TYPE_KEY,
      label: "Type",
      options: TRANSITION_TYPES.map((type) => type.name),
      menu: true,
      defaultValue: DEFAULT_TRANSITION_TYPE.name,
    },
    {
      kind: "enum",
      key: DIRECTION_KEY,
      label: "Direction",
      options: TRANSITION_DIRECTIONS,
      defaultValue: DEFAULT_DIRECTION,
      visibleWhen: { key: TYPE_KEY, values: typesUsing("direction") },
    },
    {
      kind: "number",
      key: SOFTNESS_KEY,
      label: "Softness",
      min: 0,
      max: 1,
      defaultValue: DEFAULT_SOFTNESS,
      step: 0.01,
      format: formatPercent,
      visibleWhen: { key: TYPE_KEY, values: typesUsing("softness") },
    },
    {
      kind: "enum",
      key: IRIS_KEY,
      label: "Iris",
      options: TRANSITION_IRISES,
      defaultValue: DEFAULT_IRIS,
      visibleWhen: { key: TYPE_KEY, values: typesUsing("iris") },
    },
    {
      kind: "enum",
      key: ORIENTATION_KEY,
      label: "Orientation",
      options: TRANSITION_ORIENTATIONS,
      defaultValue: DEFAULT_ORIENTATION,
      visibleWhen: { key: TYPE_KEY, values: typesUsing("orientation") },
    },
    {
      kind: "number",
      key: COUNT_KEY,
      label: "Count",
      min: MIN_COUNT,
      max: MAX_COUNT,
      defaultValue: DEFAULT_COUNT,
      step: 1,
      format: (value) => String(Math.round(value)),
      visibleWhen: { key: TYPE_KEY, values: typesUsing("count") },
    },
    {
      kind: "enum",
      key: ORIGIN_KEY,
      label: "Origin",
      options: TRANSITION_ORIGINS,
      defaultValue: DEFAULT_ORIGIN,
      visibleWhen: { key: TYPE_KEY, values: typesUsing("origin") },
    },
  ],
};
