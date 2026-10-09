import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CubeParseError,
  identityCubeLut,
  parseCubeLut,
  sampleCubeLut,
} from "./cube.ts";

// A 2-point LUT that inverts each channel.
const INVERT = `# Created by hand
TITLE "Invert"

LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
1 1 1
0 1 1
1 0 1
0 0 1
1 1 0
0 1 0
1 0 0
0 0 0
`;

function assertClose(actual: readonly number[], expected: readonly number[]) {
  assert.equal(actual.length, expected.length);
  for (const [index, value] of actual.entries()) {
    assert.ok(
      Math.abs(value - expected[index]) < 1e-6,
      `${actual} is not ${expected}`,
    );
  }
}

describe("parseCubeLut", () => {
  it("reads the title, size, domain and points, red fastest", () => {
    const lut = parseCubeLut(INVERT);
    assert.equal(lut.title, "Invert");
    assert.equal(lut.size, 2);
    assert.deepEqual(lut.domainMin, [0, 0, 0]);
    assert.deepEqual(lut.domainMax, [1, 1, 1]);
    assert.equal(lut.data.length, 24);
    assert.deepEqual(Array.from(lut.data.slice(3, 6)), [0, 1, 1]);
  });

  it("ignores comments, blank lines, CRLF endings and a BOM", () => {
    const text = `\uFEFF${INVERT.replace("1 1 1\n", "1 1 1 # first\n\n")}`
      .split("\n")
      .join("\r\n");
    assert.equal(parseCubeLut(text).size, 2);
  });

  it("defaults the domain to 0..1 and reads a custom one", () => {
    const lut = parseCubeLut(
      INVERT.replace("DOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n", ""),
    );
    assert.deepEqual(lut.domainMax, [1, 1, 1]);
    const wide = parseCubeLut(
      INVERT.replace("DOMAIN_MAX 1 1 1", "DOMAIN_MAX 2 4 8"),
    );
    assert.deepEqual(wide.domainMax, [2, 4, 8]);
    assertClose(sampleCubeLut(wide, [1, 2, 4]), [0.5, 0.5, 0.5]);
  });

  it("reads Resolve's LUT_3D_INPUT_RANGE as the domain", () => {
    const lut = parseCubeLut(
      INVERT.replace(
        "DOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1",
        "LUT_3D_INPUT_RANGE -0.5 1.5",
      ),
    );
    assert.deepEqual(lut.domainMin, [-0.5, -0.5, -0.5]);
    assert.deepEqual(lut.domainMax, [1.5, 1.5, 1.5]);
  });

  it("reads a 33-point LUT", () => {
    const identity = identityCubeLut(33);
    const lines = ["LUT_3D_SIZE 33"];
    for (let index = 0; index < identity.data.length; index += 3) {
      lines.push(Array.from(identity.data.slice(index, index + 3)).join(" "));
    }
    const lut = parseCubeLut(lines.join("\n"));
    assert.equal(lut.size, 33);
    assert.equal(lut.data.length, 33 ** 3 * 3);
  });

  it("rejects malformed files with a message", () => {
    const cases: Array<[string, RegExp]> = [
      ["", /no LUT_3D_SIZE/],
      ["hello world", /no LUT_3D_SIZE/],
      ["LUT_1D_SIZE 1024\n0 0 0", /1D LUTs are not supported/],
      ["LUT_3D_SIZE 1", /from 2 to 256/],
      ["LUT_3D_SIZE 2.5", /from 2 to 256/],
      ["LUT_3D_SIZE 512", /from 2 to 256/],
      ["LUT_3D_SIZE many", /Line 1: expected 1 number/],
      ["0 0 0\nLUT_3D_SIZE 2", /before LUT_3D_SIZE/],
      [INVERT.replace("0 1 1", "0 1"), /Line \d+: expected 3 numbers/],
      [INVERT.replace("0 1 1", "0 one 1"), /Line \d+: expected 3 numbers/],
      [INVERT.replace(/0 0 0\n$/, ""), /Expected 8 points .* found 7/],
      [`${INVERT}0 0 0\n`, /Expected 8 points .* found 9/],
      [
        INVERT.replace("DOMAIN_MAX 1 1 1", "DOMAIN_MAX 1 0 1"),
        /DOMAIN_MAX must be above DOMAIN_MIN/,
      ],
      [`${INVERT}TITLE "late"\n`, /comes after the LUT data/],
    ];
    for (const [text, message] of cases) {
      assert.throws(
        () => parseCubeLut(text),
        (error: unknown) =>
          error instanceof CubeParseError && message.test(error.message),
        text,
      );
    }
  });
});

describe("sampleCubeLut", () => {
  it("returns an identity LUT's input", () => {
    const lut = identityCubeLut(17);
    for (const color of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.55, 0.9],
      [0.031, 0.5, 0.999],
    ] as const) {
      assertClose(sampleCubeLut(lut, color), color);
    }
  });

  it("interpolates trilinearly between points", () => {
    const lut = parseCubeLut(INVERT);
    assertClose(sampleCubeLut(lut, [0.25, 0.5, 0.75]), [0.75, 0.5, 0.25]);
  });

  it("clamps input outside the domain", () => {
    const lut = parseCubeLut(INVERT);
    assertClose(sampleCubeLut(lut, [-1, 2, 0.5]), [1, 0, 0.5]);
  });
});
