import type { CubeLut } from "./cube.ts";

// LUTs that ship with the app, listed in the LUT picker above the media
// library's. Each is stored in a session by its name.
export type BundledLut = {
  name: string;
  // Built on first use.
  lut: () => CubeLut;
};

export const BUNDLED_LUTS: readonly BundledLut[] = [];

export function findBundledLut(value: string | undefined) {
  const name = value?.trim().toLowerCase();
  return name
    ? BUNDLED_LUTS.find((entry) => entry.name.toLowerCase() === name)
    : undefined;
}
