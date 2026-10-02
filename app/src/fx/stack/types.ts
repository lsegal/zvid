import type { EffectAnimation } from "../../fx-animation-defaults.ts";
import type {
  FxEffectDomain,
  FxFlagOption,
  FxNumberControl,
  FxScaleTick,
} from "../../fx-registry.ts";

export type EffectParameter = {
  key: string;
  value: string;
  numericValue?: number;
};

export type SessionEffect = {
  id: string;
  trackId: string;
  effectName: string;
  parameters: EffectParameter[];
  // Bypass flag, saved to `.lvp` as zvid-only `enabled: false`.
  enabled: boolean;
  // The Animation modifier's settings, once it has been turned on. Saved to
  // `.lvp` as zvid-only `animation`.
  animation?: EffectAnimation;
};

export type FxDeviceParameter = {
  key: string;
  label: string;
  kind:
    | "number"
    | "enum"
    | "color"
    | "gradient"
    | "text"
    | "font"
    | "flags"
    | "layers";
  // Position of the value within [min, max], 0..1, for meters.
  value: number;
  numericValue?: number;
  stringValue?: string;
  min: number;
  max: number;
  defaultValue: number | string;
  step?: number;
  // How a number is edited, when not with a knob.
  control?: FxNumberControl;
  ticks?: readonly FxScaleTick[];
  options?: readonly string[];
  // The toggles of a `flags` parameter.
  flags?: readonly FxFlagOption[];
  // An enum picked from a dropdown menu.
  menu?: boolean;
  // Shown dimmed, still editable, while it has no visible effect.
  dimmed?: boolean;
  display: string;
};

export type FxDeviceGroup = "layer" | "clip" | "global";

export type FxDevice = {
  id: string;
  effectName: string;
  name: string;
  description: string;
  subtitle: string;
  accent: string;
  group: FxDeviceGroup;
  // Audio devices are badged in the rack.
  domain: FxEffectDomain;
  enabled: boolean;
  // True when the effect can carry the Animation modifier (every known
  // video effect but Layout).
  supportsAnimation: boolean;
  // The modifier's settings, once it has been turned on.
  animation?: EffectAnimation;
  // True for a layer's own Layout device. Every visual layer has exactly
  // one, so it can be reset to its defaults but not removed or duplicated.
  layerDefault?: boolean;
  // Labels for the knob rows, when the knobs split evenly into labeled
  // rows, such as a Move's Start and End.
  knobRows?: readonly string[];
  // True for a device on a stack its effect isn't designed for, such as a
  // Global Layout from an older session. It still loads and can be removed.
  unsupported?: boolean;
  // A problem to point out on the device, such as layers an Order grid has
  // no cell for.
  warning?: string;
  parameters: FxDeviceParameter[];
};
