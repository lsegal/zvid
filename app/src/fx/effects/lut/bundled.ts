// The film-look LUTs that ship with the app, listed under "Built-in" in the
// LUT picker above the media library's. Their `.cube` files live in
// public/luts/ and are written by scripts/gen-film-luts.mjs, which holds each
// look's color transform. A session stores a bundled LUT by its id, so it
// opens the same on any machine without importing the file: never rename or
// reuse an id.

export const BUNDLED_LUT_GROUP = "Built-in";

export type BundledLut = {
  /** Stable id stored in sessions, `builtin:<slug>`. */
  id: string;
  /** Name shown in the LUT picker. */
  name: string;
  /** File name in public/luts/. */
  file: string;
};

function bundledLut(slug: string, name: string): BundledLut {
  return { id: `builtin:${slug}`, name, file: `${slug}.cube` };
}

export const BUNDLED_LUTS: readonly BundledLut[] = [
  bundledLut("bw-film", "Black & White Film"),
  bundledLut("sepia", "Sepia"),
  bundledLut("faded-vintage", "Faded Vintage Print"),
  bundledLut("warm-70s", "Warm 70s Film"),
  bundledLut("cool-90s", "Cool 90s Film"),
  bundledLut("bleach-bypass", "Bleach Bypass"),
  bundledLut("cross-processed", "Cross-Processed"),
  bundledLut("two-strip", "Two-Strip Color"),
  bundledLut("high-contrast", "High-Contrast Film"),
  bundledLut("teal-orange", "Teal & Orange"),
];

export function findBundledLut(value: string | undefined) {
  const id = value?.trim().toLowerCase();
  return id ? BUNDLED_LUTS.find((entry) => entry.id === id) : undefined;
}

/** The URL the app serves a bundled LUT's `.cube` file from. */
export function bundledLutUrl(entry: BundledLut) {
  return `/luts/${entry.file}`;
}
