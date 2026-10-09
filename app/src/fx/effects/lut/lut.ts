// The LUT effect's name, parameters and stored values, shared by its
// definition, pass, picker and the session code that finds the media it
// uses.

import { type BundledLut, findBundledLut } from "./bundled.ts";

export const LUT_EFFECT_NAME = "LUT";
export const LUT_KEY = "LUT";
export const INTENSITY_KEY = "_Intensity";

// The stored value of no LUT, which leaves the picture as it is.
export const NO_LUT = "None";

export function isLutEffectName(effectName: string) {
  return effectName.trim().toLowerCase() === "lut";
}

// A LUT from the media library is stored as `Custom:<path>`, naming its
// `.cube` file by path, like clips name theirs and Shape ▸ Custom its SVG.
// A bundled LUT is stored by its stable `builtin:` id (see bundled.ts).
const CUSTOM_PREFIX = "Custom:";

export function customLutValue(mediaPath: string) {
  return `${CUSTOM_PREFIX}${mediaPath}`;
}

// The media path a stored LUT value names, if it is a custom one.
export function customLutMediaPath(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (
    trimmed.slice(0, CUSTOM_PREFIX.length).toLowerCase() !==
    CUSTOM_PREFIX.toLowerCase()
  ) {
    return undefined;
  }
  return trimmed.slice(CUSTOM_PREFIX.length).trim() || undefined;
}

// A stored LUT value as people read it: None, a bundled LUT's name, or a
// custom one's file name.
export function describeLut(value: string | undefined) {
  if (isNoLut(value)) {
    return NO_LUT;
  }
  const path = customLutMediaPath(value);
  if (path) {
    return path.split(/[/\\]/).pop() ?? path;
  }
  return findBundledLut(value)?.name ?? value?.trim() ?? "";
}

export function isNoLut(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return !trimmed || trimmed.toLowerCase() === NO_LUT.toLowerCase();
}

// The stored values of the enabled LUTs among `effects`, such as a
// session's.
function enabledLutValues(
  effects: readonly {
    effectName: string;
    enabled?: boolean;
    parameters: readonly { key: string; value: string }[];
  }[],
) {
  return effects
    .filter(
      (effect) =>
        effect.enabled !== false && isLutEffectName(effect.effectName),
    )
    .map(
      (effect) =>
        effect.parameters.find(
          (parameter) => parameter.key.toLowerCase() === LUT_KEY.toLowerCase(),
        )?.value,
    );
}

// The `.cube` media paths of the enabled LUTs among `effects`, such as a
// session's, without repeats.
export function customLutMediaPaths(
  effects: Parameters<typeof enabledLutValues>[0],
) {
  const paths = new Set<string>();
  for (const value of enabledLutValues(effects)) {
    const path = customLutMediaPath(value);
    if (path) {
      paths.add(path);
    }
  }
  return Array.from(paths);
}

// The bundled LUTs the enabled LUTs among `effects` use, without repeats.
export function bundledLutsIn(effects: Parameters<typeof enabledLutValues>[0]) {
  const luts = new Set<BundledLut>();
  for (const value of enabledLutValues(effects)) {
    const lut = findBundledLut(value);
    if (lut) {
      luts.add(lut);
    }
  }
  return Array.from(luts);
}
