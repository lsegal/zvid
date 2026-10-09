// The LUT effect's name, parameters and stored values, shared by its
// definition, pass, picker and the session code that finds the media it
// uses.

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
// A bundled LUT is stored by its name.
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

export function isNoLut(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return !trimmed || trimmed.toLowerCase() === NO_LUT.toLowerCase();
}

// The `.cube` media paths of the enabled LUTs among `effects`, such as a
// session's, without repeats.
export function customLutMediaPaths(
  effects: readonly {
    effectName: string;
    enabled?: boolean;
    parameters: readonly { key: string; value: string }[];
  }[],
) {
  const paths = new Set<string>();
  for (const effect of effects) {
    if (effect.enabled === false || !isLutEffectName(effect.effectName)) {
      continue;
    }
    const value = effect.parameters.find(
      (parameter) => parameter.key.toLowerCase() === LUT_KEY.toLowerCase(),
    )?.value;
    const path = customLutMediaPath(value);
    if (path) {
      paths.add(path);
    }
  }
  return Array.from(paths);
}
