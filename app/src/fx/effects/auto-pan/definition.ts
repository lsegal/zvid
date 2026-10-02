import { NOTE_VALUE_OPTIONS } from "../../../audio-mix/tempo.ts";
import { formatPercent } from "../../params.ts";
import type { FxEffectDefinition } from "../../types.ts";
import {
  AUTO_PAN_EFFECT_NAME,
  DEPTH_DEFAULT,
  DEPTH_KEY,
  formatRate,
  NOTE_DEFAULT,
  NOTE_KEY,
  RATE_DEFAULT,
  RATE_KEY,
  RATE_MAX,
  RATE_MIN,
  SHAPE_DEFAULT,
  SHAPE_KEY,
  SHAPE_OPTIONS,
  SYNC_DEFAULT,
  SYNC_KEY,
  SYNC_OFF,
  SYNC_ON,
  SYNC_OPTIONS,
} from "./auto-pan.ts";

export const menuOrder = 350;

export const definition: FxEffectDefinition = {
  effectName: AUTO_PAN_EFFECT_NAME,
  displayName: "Auto Pan",
  description: "Moves the sound between left and right with an LFO.",
  accent: "#f472b6",
  category: "volume",
  domain: "audio",
  known: true,
  scopes: ["layer", "clip", "global"],
  parameters: [
    {
      kind: "enum",
      key: SYNC_KEY,
      label: "Sync",
      options: SYNC_OPTIONS,
      defaultValue: SYNC_DEFAULT,
    },
    {
      kind: "number",
      key: RATE_KEY,
      label: "Rate",
      min: RATE_MIN,
      max: RATE_MAX,
      defaultValue: RATE_DEFAULT,
      step: 0.01,
      taper: "log",
      format: formatRate,
      visibleWhen: { key: SYNC_KEY, values: [SYNC_OFF] },
    },
    {
      kind: "enum",
      key: NOTE_KEY,
      label: "Note",
      options: NOTE_VALUE_OPTIONS,
      menu: true,
      defaultValue: NOTE_DEFAULT,
      visibleWhen: { key: SYNC_KEY, values: [SYNC_ON] },
    },
    {
      kind: "number",
      key: DEPTH_KEY,
      label: "Depth",
      min: 0,
      max: 1,
      defaultValue: DEPTH_DEFAULT,
      step: 0.01,
      format: formatPercent,
    },
    {
      kind: "enum",
      key: SHAPE_KEY,
      label: "Shape",
      options: SHAPE_OPTIONS,
      defaultValue: SHAPE_DEFAULT,
    },
  ],
};
