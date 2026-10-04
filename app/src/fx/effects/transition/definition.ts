import { formatPercent } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  DEFAULT_TRANSITION_TYPE,
  TRANSITION_TYPES,
  typesUsing,
} from "./registry.ts";
import {
  DEFAULT_DIRECTION,
  DEFAULT_SOFTNESS,
  DIRECTION_KEY,
  SOFTNESS_KEY,
  TRANSITION_DIRECTIONS,
  TRANSITION_EFFECT_NAME,
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
  ],
};
