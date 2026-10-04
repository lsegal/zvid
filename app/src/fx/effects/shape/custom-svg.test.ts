import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alphaToMask, stretchSvgSource } from "./custom-svg.ts";

describe("stretchSvgSource", () => {
  it("stretches the viewBox over the box it is drawn into", () => {
    assert.equal(
      stretchSvgSource(
        '<svg viewBox="0 0 10 20"><path d="M0 0H10V20Z"/></svg>',
      ),
      '<svg viewBox="0 0 10 20" preserveAspectRatio="none"><path d="M0 0H10V20Z"/></svg>',
    );
  });

  it("replaces an existing preserveAspectRatio", () => {
    assert.equal(
      stretchSvgSource(
        "<svg viewBox='0 0 4 4' preserveAspectRatio='xMidYMid slice'/>",
      ),
      `<svg viewBox='0 0 4 4' preserveAspectRatio="none"/>`,
    );
  });

  it("gives an SVG sized only by width and height a viewBox", () => {
    const stretched = stretchSvgSource(
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="64px" height="32" stroke-width="3"><rect/></svg>',
    );
    assert.match(stretched ?? "", /viewBox="0 0 64 32"/);
    assert.match(stretched ?? "", /preserveAspectRatio="none"/);
    assert.match(stretched ?? "", /stroke-width="3"/);
    assert.match(stretched ?? "", /^<\?xml version="1.0"\?>\n<svg /);
  });

  it("rejects a file without an <svg> element", () => {
    assert.equal(stretchSvgSource("<html><body/></html>"), undefined);
    assert.equal(stretchSvgSource(""), undefined);
  });
});

describe("alphaToMask", () => {
  it("keeps each pixel's alpha, whatever its color", () => {
    const rgba = new Uint8ClampedArray([
      // Opaque black, opaque white, half-transparent red, transparent.
      0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 128, 12, 34, 56, 0,
    ]);
    assert.deepEqual(Array.from(alphaToMask(rgba)), [255, 255, 128, 0]);
  });

  it("is empty for no pixels", () => {
    assert.equal(alphaToMask([]).length, 0);
  });
});
