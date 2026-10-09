// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { MediaItem } from "../../../media.ts";
import { uniformValues } from "../../pass-test-utils.ts";
import { type CubeLut, identityCubeLut, parseCubeLut } from "./cube.ts";
import {
  bindLutTexture,
  getLutError,
  isLutReady,
  loadLutFiles,
  setLutMedia,
} from "./lut-media.ts";
import {
  type LutTileLayout,
  lutSliceUv,
  lutTexturePixels,
  lutTileLayout,
} from "./lut-texture.ts";
import { pass } from "./pass.ts";

type Color = [number, number, number, number];

// The texture's texel at `x`, `y`, clamped to its edge, as 0..1.
function texel(
  pixels: Uint8Array,
  layout: LutTileLayout,
  x: number,
  y: number,
) {
  const cx = Math.max(0, Math.min(layout.width - 1, x));
  const cy = Math.max(0, Math.min(layout.height - 1, y));
  const offset = (cy * layout.width + cx) * 4;
  return [0, 1, 2].map((channel) => pixels[offset + channel] / 255);
}

function mix(a: number[], b: number[], t: number) {
  return a.map((value, channel) => value + (b[channel] - value) * t);
}

// texture2D with LINEAR filtering and CLAMP_TO_EDGE.
function sampleLinear(
  pixels: Uint8Array,
  layout: LutTileLayout,
  [u, v]: [number, number],
) {
  const x = u * layout.width - 0.5;
  const y = v * layout.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  return mix(
    mix(
      texel(pixels, layout, x0, y0),
      texel(pixels, layout, x0 + 1, y0),
      x - x0,
    ),
    mix(
      texel(pixels, layout, x0, y0 + 1),
      texel(pixels, layout, x0 + 1, y0 + 1),
      x - x0,
    ),
    y - y0,
  );
}

// The pass's fragment shader, step by step, for one pixel.
function shade(lut: CubeLut, color: Color, intensity: number): Color {
  const layout = lutTileLayout(lut.size);
  const pixels = lutTexturePixels(lut, layout);
  const last = lut.size - 1;
  const cell = [0, 1, 2].map((channel) => {
    const min = lut.domainMin[channel];
    const unit = (color[channel] - min) / (lut.domainMax[channel] - min);
    return Math.max(0, Math.min(1, unit)) * last;
  });
  const slice = Math.floor(cell[2]);
  const next = Math.min(slice + 1, last);
  const low = sampleLinear(
    pixels,
    layout,
    lutSliceUv(layout, slice, cell[0], cell[1]),
  );
  const high = sampleLinear(
    pixels,
    layout,
    lutSliceUv(layout, next, cell[0], cell[1]),
  );
  const graded = mix(low, high, cell[2] - slice);
  const rgb = mix(color.slice(0, 3), graded, intensity);
  return [rgb[0], rgb[1], rgb[2], color[3]];
}

function assertClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1.5 / 255,
) {
  for (const [index, value] of expected.entries()) {
    assert.ok(
      Math.abs(actual[index] - value) <= tolerance,
      `[${actual.join(", ")}] is not [${expected.join(", ")}]`,
    );
  }
}

// Brightens shadows: each output is the square root of its input, over 5
// points a side.
function sqrtLut(): CubeLut {
  const size = 5;
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        lines.push(
          [r, g, b].map((index) => Math.sqrt(index / (size - 1))).join(" "),
        );
      }
    }
  }
  return parseCubeLut(lines.join("\n"));
}

const SAMPLES: Color[] = [
  [0, 0, 0, 1],
  [1, 1, 1, 1],
  [0.25, 0.5, 0.75, 0.5],
  [0.1, 0.9, 0.33, 0],
  [0.62, 0.07, 0.48, 0.8],
];

describe("LUT pass shader", () => {
  it("leaves the picture as it is through an identity LUT", () => {
    for (const size of [2, 17, 33]) {
      const lut = identityCubeLut(size);
      for (const color of SAMPLES) {
        assertClose(shade(lut, color, 1), color);
      }
    }
  });

  it("maps colors through a LUT, interpolating between its points", () => {
    const lut = sqrtLut();
    // On points.
    assertClose(shade(lut, [0.25, 0.5, 1, 1], 1), [0.5, Math.sqrt(0.5), 1]);
    // Between points: red halfway between the points at 0.25 and 0.5, blue
    // halfway between those at 0 and 0.25.
    assertClose(shade(lut, [0.375, 0.75, 0.125, 1], 1), [
      (0.5 + Math.sqrt(0.5)) / 2,
      Math.sqrt(0.75),
      0.25,
    ]);
  });

  it("reads the right slice of a LUT tiled over rows and columns", () => {
    // 33 points a side tile into 6 columns and 6 rows of slices.
    const identity = identityCubeLut(33);
    const lut = {
      ...identity,
      data: identity.data.map((value, index) =>
        index % 3 === 1 ? 1 - value : value,
      ),
    };
    assertClose(shade(lut, [0.3, 0.6, 0.97, 1], 1), [0.3, 0.4, 0.97]);
    assertClose(shade(lut, [0.8, 0.1, 0.41, 1], 1), [0.8, 0.9, 0.41]);
  });

  it("is the original at Intensity 0 and blends in between", () => {
    const lut = sqrtLut();
    for (const color of SAMPLES) {
      assertClose(shade(lut, color, 0), color);
    }
    const full = shade(lut, [0.25, 0.25, 0.25, 1], 1);
    const half = shade(lut, [0.25, 0.25, 0.25, 1], 0.5);
    assertClose(
      half,
      [0, 1, 2].map((channel) => (0.25 + full[channel]) / 2),
    );
  });

  it("keeps alpha", () => {
    for (const color of SAMPLES) {
      assert.equal(shade(sqrtLut(), color, 1)[3], color[3]);
    }
    assert.match(
      pass.fragmentSource,
      /gl_FragColor = vec4\(mix\(c\.rgb, graded, uIntensity\), c\.a\);/,
    );
  });

  it("reads the LUT texture unscaled by the chain", () => {
    assert.match(
      pass.fragmentSource,
      /texture2DProj\(uLut, vec3\(lutSliceUv\(slice, cell\.rg\), 1\.0\)\)/,
    );
    assert.doesNotMatch(pass.fragmentSource, /texture2D\(uLut/);
  });
});

const CUBE = `LUT_3D_SIZE 2
1 1 1
0 1 1
1 0 1
0 0 1
1 1 0
0 1 0
1 0 0
0 0 0
`;

function cubeMedia(
  name: string,
  text: string,
  overrides: Partial<MediaItem> = {},
): MediaItem {
  return {
    id: name,
    name,
    kind: "lut",
    durationSeconds: 0,
    hasAudio: false,
    hasVideo: false,
    color: "#000",
    accent: "#000",
    previewUrl: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
    sourcePath: `/looks/${name}`,
    availability: "ready",
    ...overrides,
  };
}

const lutParams = (value: string, intensity = 1) => [
  { key: "LUT", value },
  { key: "_Intensity", value: String(intensity), numericValue: intensity },
];

// A WebGL stand-in recording texture uploads.
function fakeGl() {
  const uploads: Array<{ width: number; height: number }> = [];
  const gl = {
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 1,
    RGBA: 2,
    UNSIGNED_BYTE: 3,
    activeTexture() {},
    createTexture: () => ({}),
    bindTexture() {},
    pixelStorei() {},
    texParameteri() {},
    texImage2D(
      _target: number,
      _level: number,
      _format: number,
      width: number,
      height: number,
    ) {
      uploads.push({ width, height });
    },
  } as unknown as WebGLRenderingContext;
  return { gl, uploads };
}

describe("LUT pass", () => {
  afterEach(() => setLutMedia([]));

  it("skips None and leaves the picture unchanged", () => {
    assert.equal(pass.isIdentity?.(lutParams("None")), true);
    assert.deepEqual(uniformValues(pass, lutParams("None")).uIntensity, [0]);
  });

  it("skips a custom LUT until its file has loaded, and at Intensity 0", async () => {
    setLutMedia([cubeMedia("invert.cube", CUBE)]);
    const params = lutParams("Custom:/looks/invert.cube");
    assert.equal(pass.isIdentity?.(params), true);
    await loadLutFiles(["/looks/invert.cube"]);
    assert.equal(isLutReady(params[0].value), true);
    assert.equal(pass.isIdentity?.(params), false);
    assert.equal(
      pass.isIdentity?.(lutParams("Custom:/looks/invert.cube", 0)),
      true,
    );
  });

  it("finds a custom LUT by file name when its path differs", async () => {
    setLutMedia([cubeMedia("invert.cube", CUBE)]);
    await loadLutFiles(["D:\\elsewhere\\invert.cube"]);
    assert.equal(isLutReady("Custom:D:\\elsewhere\\invert.cube"), true);
  });

  it("skips an offline custom LUT", async () => {
    setLutMedia([
      cubeMedia("gone.cube", CUBE, { availability: "offline", previewUrl: "" }),
    ]);
    await loadLutFiles(["/looks/gone.cube"]);
    assert.equal(pass.isIdentity?.(lutParams("Custom:/looks/gone.cube")), true);
  });

  it("falls back to no change for a malformed file, with its reason", async () => {
    setLutMedia([cubeMedia("bad.cube", "LUT_3D_SIZE 2\n0 0 0\n")]);
    await loadLutFiles(["/looks/bad.cube"]);
    const value = "Custom:/looks/bad.cube";
    assert.equal(pass.isIdentity?.(lutParams(value)), true);
    assert.match(getLutError(value) ?? "", /Expected 8 points/);
  });

  it("uploads a loaded LUT's tiled texture once and feeds its layout", async () => {
    setLutMedia([cubeMedia("invert.cube", CUBE)]);
    await loadLutFiles(["/looks/invert.cube"]);
    const { gl, uploads } = fakeGl();
    const value = "Custom:/looks/invert.cube";
    assert.deepEqual(bindLutTexture(gl, value, 7)?.layout, lutTileLayout(2));
    bindLutTexture(gl, value, 7);
    assert.deepEqual(uploads, [{ width: 4, height: 2 }]);
  });
});
