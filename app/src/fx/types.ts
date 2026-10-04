// Types describing an effect: its parameters (label, range, default and
// display format) and the stacks it is designed for.

// Shows a parameter only while the parameter `key` holds one of `values`
// (compared as numbers when both are numeric, otherwise case-insensitively).
export type FxParameterVisibility = {
  key: string;
  values: readonly string[];
};

export type FxNumberParameterDefinition = {
  kind: "number";
  key: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  format: (value: number) => string;
  // How the value is edited: a knob (the default), a vertical fader, or an
  // on/off toggle for a 0..1 value stored as 0 or 1.
  control?: FxNumberControl;
  // How a knob's travel maps to the range: evenly (the default), or by
  // ratio for frequencies and times, so drags and steps move the value
  // logarithmically. A log taper needs `min` above 0.
  taper?: FxNumberTaper;
  // Scale marks beside a fader.
  ticks?: readonly FxScaleTick[];
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
};

export type FxNumberControl = "knob" | "fader" | "toggle";

export type FxNumberTaper = "linear" | "log";

export type FxScaleTick = { value: number; label: string };

// Reads another parameter's stored value on the same effect.
export type FxParameterReader = (key: string) => string | undefined;

export type FxEnumParameterDefinition = {
  kind: "enum";
  key: string;
  label: string;
  options: readonly string[];
  // The options available for the effect's current values, a subset of
  // `options` in the same order. A stored value outside them shows as the
  // nearest one.
  optionsFor?: (read: FxParameterReader) => readonly string[];
  // Picks from a dropdown menu instead of segmented buttons, for long
  // option lists.
  menu?: boolean;
  defaultValue: string;
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
};

// A toggle in a `flags` parameter: `value` is stored, `label` is its button
// and `title` its accessible name.
export type FxFlagOption = { value: string; label: string; title: string };

// String parameters with their own editors: a CSS color (`color`) or CSS
// linear/radial gradient (`gradient`) with a color picker, free text
// (`text`) in a text area, a font (`font`) from the font list, a set of
// toggles (`flags`) stored comma-separated, a set of layers (`layers`)
// stored as comma-separated layer ids, one layer (`layer`) stored as its id,
// empty for none, and a shape (`shape`) by name, from the Shape effect's
// shapes.
type FxStringParameterFields = {
  key: string;
  label: string;
  defaultValue: string;
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
  // Dims the control, which stays editable, while it has no visible effect:
  // while the condition, or every one of a list of them, holds.
  dimmedWhen?: FxParameterVisibility | readonly FxParameterVisibility[];
};

export type FxStringParameterDefinition =
  | (FxStringParameterFields & { kind: "color" })
  | (FxStringParameterFields & { kind: "gradient" })
  | (FxStringParameterFields & { kind: "text" })
  | (FxStringParameterFields & { kind: "font" })
  | (FxStringParameterFields & { kind: "layers" })
  | (FxStringParameterFields & { kind: "layer" })
  | (FxStringParameterFields & { kind: "shape" })
  | (FxStringParameterFields & {
      kind: "flags";
      options: readonly FxFlagOption[];
    });

export type FxParameterDefinition =
  | FxNumberParameterDefinition
  | FxEnumParameterDefinition
  | FxStringParameterDefinition;

// The stacks an effect is designed for: a clip's own stack, which processes
// that clip before its layer does, a layer's own stack, the Global stack
// that processes the composite, and an FX clip's own stack, which processes
// the composite beneath the FX clip. Effects that make content (Color, Text)
// or place a layer (Layout) have nothing to work on in an FX clip.
export type FxEffectScope = "layer" | "clip" | "global" | "fxClip";

export const ALL_SCOPES: readonly FxEffectScope[] = [
  "layer",
  "clip",
  "global",
  "fxClip",
];

// What an effect processes: the picture (`video`) or the sound (`audio`).
// Both kinds share a stack and its order; video passes skip audio effects
// and the audio engine skips video ones.
export type FxEffectDomain = "video" | "audio";

// The add menus' category submenus; FX_EFFECT_CATEGORIES in fx-chain.ts
// gives their labels and order within each domain.
export type FxEffectCategory =
  | "transform"
  | "color"
  | "stylize"
  | "text"
  | "volume"
  | "eq"
  | "dynamics"
  | "modulation"
  | "distortion"
  | "utility";

export type FxEffectDefinition = {
  effectName: string;
  displayName: string;
  description: string;
  accent: string;
  // Unset for video effects.
  domain?: FxEffectDomain;
  // The submenu the add menus list the effect under.
  category: FxEffectCategory;
  parameters: FxParameterDefinition[];
  // Stacks the add menus offer the effect on. A device loaded onto any other
  // stack still shows, flagged as not supported there.
  scopes: readonly FxEffectScope[];
  // True for an effect every visual layer is given exactly once, so no add
  // menu offers it.
  layerDefault?: boolean;
  // Labels for the knob rows, when the knobs split evenly into labeled
  // rows (a Move's Start and End) instead of filling two rows freely.
  knobRows?: readonly string[];
  // Keys of parameters the effect no longer has. Collaboration peers on
  // older builds still publish them, so the device does not list them as
  // unknown raw parameters.
  retiredParameters?: readonly string[];
  // False for the placeholder returned for effect names the registry does
  // not know; those devices show their raw parameter keys.
  known: boolean;
};

// What each effect folder's definition.ts exports. `menuOrder` places the
// effect in the add menus, lowest first.
export type FxEffectDefinitionModule = {
  definition: FxEffectDefinition;
  menuOrder: number;
};
