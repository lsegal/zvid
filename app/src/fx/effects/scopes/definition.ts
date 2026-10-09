import type { FxEffectDefinition } from "../../types.ts";
import { ALL_SCOPES } from "../../types.ts";

// Where the effect sits in the add menus, lowest first.
export const menuOrder = 24;

// View only: it leaves the picture as it is and shows a waveform of the
// picture at its position in the stack. It has nothing to edit or animate.
export const definition: FxEffectDefinition = {
  effectName: "Scopes",
  displayName: "Scopes",
  description:
    "Shows an RGB waveform of the picture at this point in the stack, without changing it.",
  accent: "#f2d14b",
  category: "color",
  known: true,
  scopes: ALL_SCOPES,
  parameters: [
    {
      kind: "waveform",
      key: "_Waveform",
      label: "Waveform",
      defaultValue: "",
    },
  ],
};
