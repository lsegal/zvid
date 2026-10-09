// The film-look LUTs bundled with zvid. The files live in public/luts/ and
// are written by scripts/gen-film-luts.mjs, which holds each look's color
// transform. Sessions store a bundled LUT by its id, so a session that uses
// one opens the same on any machine without importing the file: never rename
// or reuse an id.

export const BUILTIN_LUT_GROUP = "Built-in";
export const BUILTIN_LUT_ID_PREFIX = "builtin:";
export const BUILTIN_LUT_DIRECTORY = "luts";

export interface BuiltinLut {
  /** Stable id stored in sessions, `builtin:<slug>`. */
  id: string;
  /** Name shown in the LUT picker. */
  name: string;
  /** File name in public/luts/. */
  file: string;
}

function builtinLut(slug: string, name: string): BuiltinLut {
  return { id: `${BUILTIN_LUT_ID_PREFIX}${slug}`, name, file: `${slug}.cube` };
}

export const BUILTIN_LUTS: readonly BuiltinLut[] = [
  builtinLut("bw-film", "Black & White Film"),
  builtinLut("sepia", "Sepia"),
  builtinLut("faded-vintage", "Faded Vintage Print"),
  builtinLut("warm-70s", "Warm 70s Film"),
  builtinLut("cool-90s", "Cool 90s Film"),
  builtinLut("bleach-bypass", "Bleach Bypass"),
  builtinLut("cross-processed", "Cross-Processed"),
  builtinLut("two-strip", "Two-Strip Color"),
  builtinLut("high-contrast", "High-Contrast Film"),
  builtinLut("teal-orange", "Teal & Orange"),
];

export function isBuiltinLutId(id: string) {
  return id.startsWith(BUILTIN_LUT_ID_PREFIX);
}

export function findBuiltinLut(id: string): BuiltinLut | undefined {
  return BUILTIN_LUTS.find((lut) => lut.id === id);
}

/** URL of a bundled LUT's `.cube` file, relative to the app's base URL. */
export function builtinLutUrl(lut: BuiltinLut, baseUrl = "/") {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}${BUILTIN_LUT_DIRECTORY}/${lut.file}`;
}
