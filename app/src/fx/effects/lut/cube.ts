// Reading 3D LUTs from Adobe/Resolve `.cube` files, and sampling them as the
// LUT pass does on the GPU.

export type CubeLut = {
  title?: string;
  // Points along each side of the cube.
  size: number;
  // The input values the cube's first and last points stand for, per channel.
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  // `size`³ RGB triples, red changing fastest, then green, then blue.
  data: Float32Array;
};

// Sides past this would make textures some GPUs can't hold.
export const MAX_CUBE_SIZE = 256;

export class CubeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CubeParseError";
  }
}

function readNumbers(words: string[], count: number, line: number) {
  const values = words.map(Number);
  if (
    values.length !== count ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new CubeParseError(
      `Line ${line}: expected ${count} number${count === 1 ? "" : "s"}.`,
    );
  }
  return values;
}

/**
 * The 3D LUT a `.cube` file's `text` holds. Throws a CubeParseError naming
 * the problem when it isn't one: 1D LUTs, a missing or out-of-range
 * `LUT_3D_SIZE`, an empty domain, malformed lines, or the wrong number of
 * points.
 */
export function parseCubeLut(text: string): CubeLut {
  let title: string | undefined;
  let size: number | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  // A byte order mark some editors write isn't part of the first line.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r\n|\r|\n/);
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const content = raw.replace(/#.*$/, "").trim();
    if (!content) {
      continue;
    }
    const keyword = /^[A-Za-z_][A-Za-z0-9_]*/.exec(content)?.[0];
    if (!keyword) {
      if (size === undefined) {
        throw new CubeParseError(
          `Line ${line}: LUT data comes before LUT_3D_SIZE.`,
        );
      }
      values.push(...readNumbers(content.split(/\s+/), 3, line));
      continue;
    }
    if (values.length) {
      throw new CubeParseError(
        `Line ${line}: ${keyword} comes after the LUT data.`,
      );
    }
    const rest = content.slice(keyword.length).trim();
    const words = rest ? rest.split(/\s+/) : [];
    switch (keyword.toUpperCase()) {
      case "TITLE":
        title = /^"(.*)"$/.exec(rest)?.[1] ?? rest;
        break;
      case "LUT_3D_SIZE": {
        const [value] = readNumbers(words, 1, line);
        if (!Number.isInteger(value) || value < 2 || value > MAX_CUBE_SIZE) {
          throw new CubeParseError(
            `Line ${line}: LUT_3D_SIZE must be a whole number from 2 to ${MAX_CUBE_SIZE}.`,
          );
        }
        size = value;
        break;
      }
      case "LUT_1D_SIZE":
        throw new CubeParseError("1D LUTs are not supported, only 3D ones.");
      case "DOMAIN_MIN":
        domainMin = readNumbers(words, 3, line) as [number, number, number];
        break;
      case "DOMAIN_MAX":
        domainMax = readNumbers(words, 3, line) as [number, number, number];
        break;
      case "LUT_3D_INPUT_RANGE": {
        // Resolve's spelling of one domain for all three channels.
        const [min, max] = readNumbers(words, 2, line);
        domainMin = [min, min, min];
        domainMax = [max, max, max];
        break;
      }
      default:
        // Other keywords, such as LUT_1D_INPUT_RANGE in a combined file or
        // vendor extensions, don't change a 3D LUT.
        break;
    }
  }
  if (size === undefined) {
    throw new CubeParseError("Not a 3D LUT: it has no LUT_3D_SIZE.");
  }
  if (domainMin.some((min, channel) => !(domainMax[channel] > min))) {
    throw new CubeParseError("DOMAIN_MAX must be above DOMAIN_MIN.");
  }
  const expected = size ** 3;
  if (values.length !== expected * 3) {
    throw new CubeParseError(
      `Expected ${expected} points for LUT_3D_SIZE ${size}, found ${values.length / 3}.`,
    );
  }
  return {
    ...(title ? { title } : {}),
    size,
    domainMin,
    domainMax,
    data: Float32Array.from(values),
  };
}

// The point at `r`, `g`, `b` (each 0..size-1).
function point(lut: CubeLut, r: number, g: number, b: number) {
  const offset = (r + lut.size * (g + lut.size * b)) * 3;
  return [lut.data[offset], lut.data[offset + 1], lut.data[offset + 2]];
}

function mix3(a: number[], b: number[], t: number) {
  return [0, 1, 2].map((channel) => a[channel] + (b[channel] - a[channel]) * t);
}

/**
 * `color` through `lut`, interpolated trilinearly between its points, as the
 * LUT pass grades a pixel.
 */
export function sampleCubeLut(
  lut: CubeLut,
  color: readonly [number, number, number],
): [number, number, number] {
  const last = lut.size - 1;
  const cell = color.map((value, channel) => {
    const min = lut.domainMin[channel];
    const unit = (value - min) / (lut.domainMax[channel] - min);
    return Math.max(0, Math.min(1, unit)) * last;
  });
  const low = cell.map(Math.floor);
  const high = low.map((value) => Math.min(value + 1, last));
  const [fr, fg, fb] = cell.map((value, channel) => value - low[channel]);
  const plane = (b: number) =>
    mix3(
      mix3(point(lut, low[0], low[1], b), point(lut, high[0], low[1], b), fr),
      mix3(point(lut, low[0], high[1], b), point(lut, high[0], high[1], b), fr),
      fg,
    );
  return mix3(plane(low[2]), plane(high[2]), fb) as [number, number, number];
}

/** An identity LUT of `size` points a side, mostly for tests. */
export function identityCubeLut(size: number): CubeLut {
  const data = new Float32Array(size ** 3 * 3);
  let offset = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[offset++] = r / (size - 1);
        data[offset++] = g / (size - 1);
        data[offset++] = b / (size - 1);
      }
    }
  }
  return { size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}
