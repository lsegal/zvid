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
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
};

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
// toggles (`flags`) stored comma-separated, and a set of layers (`layers`)
// stored as comma-separated layer ids.
type FxStringParameterFields = {
  key: string;
  label: string;
  defaultValue: string;
  hidden?: boolean;
  visibleWhen?: FxParameterVisibility;
  // Dims the control, which stays editable, while it has no visible effect.
  dimmedWhen?: FxParameterVisibility;
};

export type FxStringParameterDefinition =
  | (FxStringParameterFields & { kind: "color" })
  | (FxStringParameterFields & { kind: "gradient" })
  | (FxStringParameterFields & { kind: "text" })
  | (FxStringParameterFields & { kind: "font" })
  | (FxStringParameterFields & { kind: "layers" })
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

export type FxEffectDefinition = {
  effectName: string;
  displayName: string;
  description: string;
  accent: string;
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
