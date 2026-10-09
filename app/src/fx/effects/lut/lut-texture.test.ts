import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identityCubeLut, sampleCubeLut } from "./cube.ts";
import {
  lutSliceUv,
  lutTexturePixels,
  lutTileLayout,
  MAX_TEXTURE_LUT_SIZE,
  resampleCubeLut,
  textureCubeLut,
} from "./lut-texture.ts";

describe("LUT texture", () => {
  it("tiles the blue slices in a near-square grid", () => {
    assert.deepEqual(lutTileLayout(2), {
      size: 2,
      columns: 2,
      rows: 1,
      width: 4,
      height: 2,
    });
    assert.deepEqual(lutTileLayout(33), {
      size: 33,
      columns: 6,
      rows: 6,
      width: 198,
      height: 198,
    });
    assert.deepEqual(lutTileLayout(65), {
      size: 65,
      columns: 9,
      rows: 8,
      width: 585,
      height: 520,
    });
  });

  it("puts each point at the texel its coordinate centers on", () => {
    const lut = identityCubeLut(5);
    const layout = lutTileLayout(5);
    const pixels = lutTexturePixels(lut, layout);
    for (let b = 0; b < 5; b++) {
      for (let g = 0; g < 5; g++) {
        for (let r = 0; r < 5; r++) {
          const [u, v] = lutSliceUv(layout, b, r, g);
          const x = u * layout.width - 0.5;
          const y = v * layout.height - 0.5;
          assert.ok(Math.abs(x - Math.round(x)) < 1e-9);
          assert.ok(Math.abs(y - Math.round(y)) < 1e-9);
          const offset = (Math.round(y) * layout.width + Math.round(x)) * 4;
          assert.deepEqual(
            Array.from(pixels.slice(offset, offset + 4)),
            [r, g, b].map((index) => Math.round((index / 4) * 255)).concat(255),
          );
        }
      }
    }
  });

  it("clamps outputs outside 0..1", () => {
    const lut = identityCubeLut(2);
    lut.data[0] = -0.5;
    lut.data[3] = 1.5;
    const pixels = lutTexturePixels(lut);
    assert.equal(pixels[0], 0);
    assert.equal(pixels[4], 255);
  });

  it("resamples large LUTs to the texture limit over the same domain", () => {
    const lut = {
      ...identityCubeLut(3),
      domainMin: [0, 0, 0] as [number, number, number],
      domainMax: [2, 2, 2] as [number, number, number],
    };
    const resampled = resampleCubeLut(lut, 5);
    assert.equal(resampled.size, 5);
    assert.deepEqual(resampled.domainMax, [2, 2, 2]);
    for (const color of [
      [0.2, 1.1, 1.9],
      [0, 2, 1],
    ] as const) {
      const expected = sampleCubeLut(lut, color);
      for (const [channel, value] of sampleCubeLut(
        resampled,
        color,
      ).entries()) {
        assert.ok(Math.abs(value - expected[channel]) < 1e-6);
      }
    }
    assert.equal(
      textureCubeLut(identityCubeLut(MAX_TEXTURE_LUT_SIZE)).size,
      MAX_TEXTURE_LUT_SIZE,
    );
    assert.equal(
      textureCubeLut(identityCubeLut(MAX_TEXTURE_LUT_SIZE + 1)).size,
      MAX_TEXTURE_LUT_SIZE,
    );
  });
});
