import type { LvpSession } from "../../session.ts";
import { GLOBAL_EFFECT_TRACK_ID } from "./clip-stacks.ts";
import { mapEffects } from "./session-mapping.ts";
import type { SessionEffect } from "./types.ts";

// The effect stacks of the dogfood3.lvp session: Layer 3 ("6") has four
// devices, and Layout sits on the global stack, as sessions from before
// Layout was per layer did.
export const DOGFOOD_EFFECTS: LvpSession["effects"] = [
  {
    id: "zoom",
    trackId: "1",
    effectName: "ZoomAndPan",
    parameters: {
      _Start_Zoom: { floatValue: 0 },
      _End_Zoom: { floatValue: 0.23 },
      _LAYERS_SelFrac: { floatValue: 0.62 },
    },
  },
  {
    id: "pixelate",
    trackId: "6",
    effectName: "Pixelate",
    parameters: {
      _NumPixels: { floatValue: 0.83 },
      _LowIntensity: { floatValue: 0.1 },
      _HighIntensity: { floatValue: 0.9 },
    },
  },
  {
    id: "layout",
    trackId: GLOBAL_EFFECT_TRACK_ID,
    effectName: "Layout",
    parameters: { Position: { stringValue: "Center" } },
  },
  {
    id: "colorize",
    trackId: "6",
    effectName: "Colorize",
    parameters: {
      _HueOffset: { floatValue: 0.25 },
      _Reactivity: { floatValue: 0.4 },
    },
  },
  {
    id: "negative",
    trackId: "6",
    effectName: "NegativeSplit",
    parameters: {
      _LowIntensity: { floatValue: 0.2 },
      _HighIntensity: { floatValue: 0.8 },
    },
  },
  {
    id: "glitch",
    trackId: "6",
    effectName: "AnalogGlitch",
    parameters: {
      _LowMod: { floatValue: 0.3 },
      _HighMod: { floatValue: 0.6 },
    },
  },
];

export function load() {
  return mapEffects(DOGFOOD_EFFECTS);
}

export function ids(effects: SessionEffect[], trackId?: string) {
  return effects
    .filter((effect) => trackId === undefined || effect.trackId === trackId)
    .map((effect) => effect.id);
}
