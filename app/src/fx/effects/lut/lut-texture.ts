// How a 3D LUT is laid out in a 2D texture for WebGL 1, which has no 3D
// textures: its blue slices side by side in a grid, each a `size` by `size`
// square of red across and green down. The pass reads two neighboring
// slices bilinearly and mixes them, which is trilinear interpolation.

import { type CubeLut, sampleCubeLut } from "./cube.ts";

// Larger LUTs are resampled to this many points a side, which keeps their
// texture small and its coordinates precise enough for mediump shaders.
export const MAX_TEXTURE_LUT_SIZE = 65;

export type LutTileLayout = {
  size: number;
  columns: number;
  rows: number;
  width: number;
  height: number;
};

export function lutTileLayout(size: number): LutTileLayout {
  const columns = Math.ceil(Math.sqrt(size));
  const rows = Math.ceil(size / columns);
  return { size, columns, rows, width: columns * size, height: rows * size };
}

/** `lut` with `size` points a side over the same domain. */
export function resampleCubeLut(lut: CubeLut, size: number): CubeLut {
  const data = new Float32Array(size ** 3 * 3);
  const at = (index: number, channel: number) =>
    lut.domainMin[channel] +
    (index / (size - 1)) * (lut.domainMax[channel] - lut.domainMin[channel]);
  let offset = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const color = sampleCubeLut(lut, [at(r, 0), at(g, 1), at(b, 2)]);
        data.set(color, offset);
        offset += 3;
      }
    }
  }
  return { ...lut, size, data };
}

/** `lut` within the texture size limit. */
export function textureCubeLut(lut: CubeLut) {
  return lut.size > MAX_TEXTURE_LUT_SIZE
    ? resampleCubeLut(lut, MAX_TEXTURE_LUT_SIZE)
    : lut;
}

/**
 * The RGBA bytes of `lut`'s tiled texture, top row first, its outputs
 * clamped to 0..1.
 */
export function lutTexturePixels(
  lut: CubeLut,
  layout = lutTileLayout(lut.size),
) {
  const pixels = new Uint8Array(layout.width * layout.height * 4);
  const { size } = lut;
  for (let b = 0; b < size; b++) {
    const left = (b % layout.columns) * size;
    const top = Math.floor(b / layout.columns) * size;
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const source = (r + size * (g + size * b)) * 3;
        const target = ((top + g) * layout.width + left + r) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const value = Math.max(0, Math.min(1, lut.data[source + channel]));
          pixels[target + channel] = Math.round(value * 255);
        }
        pixels[target + 3] = 255;
      }
    }
  }
  return pixels;
}

/**
 * The texture coordinate of red `r` and green `g` (each 0..size-1) in blue
 * slice `slice`, as the pass's `lutSliceUv` computes it.
 */
export function lutSliceUv(
  layout: LutTileLayout,
  slice: number,
  r: number,
  g: number,
): [number, number] {
  const row = Math.floor((slice + 0.5) / layout.columns);
  const column = slice - row * layout.columns;
  return [
    (column * layout.size + r + 0.5) / layout.width,
    (row * layout.size + g + 0.5) / layout.height,
  ];
}
