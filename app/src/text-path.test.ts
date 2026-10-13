import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CircleTextInput, layoutCircleText } from "./text-path.ts";

// Every character is half an em wide, so widths are easy to work out.
const measure = (text: string, fontSize: number) =>
  Array.from(text).length * fontSize * 0.5;

const TOP = -Math.PI / 2;

function layout(overrides: Partial<CircleTextInput> = {}) {
  return layoutCircleText(
    {
      text: "ABCD",
      fontSize: 20,
      minFontSize: 8,
      resizeToFit: false,
      letterSpacing: 0,
      align: "center",
      radius: 100,
      ...overrides,
    },
    measure,
  );
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);
}

describe("layoutCircleText", () => {
  it("centers the text on the top of the circle, reading clockwise", () => {
    const { glyphs, startAngle, sweep } = layout();
    assert.deepEqual(
      glyphs.map((glyph) => glyph.text),
      ["A", "B", "C", "D"],
    );
    // 40px of text round a 100px radius.
    close(sweep, 0.4);
    close(startAngle, TOP - 0.2);
    close(glyphs[0].angle, TOP - 0.15);
    close(glyphs[3].angle, TOP + 0.15);
    assert.ok(glyphs.every((glyph) => glyph.width === 10));
  });

  it("starts at the top for Left and ends there for Right", () => {
    close(layout({ align: "left" }).glyphs[0].angle, TOP + 0.05);
    close(layout({ align: "right" }).glyphs[3].angle, TOP - 0.05);
  });

  it("spaces characters by the tracking", () => {
    const { glyphs, sweep } = layout({ letterSpacing: 0.5 });
    // Three 10px gaps between four 10px characters.
    close(sweep, 0.7);
    close(glyphs[1].angle - glyphs[0].angle, 0.2);
  });

  it("joins lines into one", () => {
    const text = layout({ text: "AB\n  CD" }).glyphs.map((glyph) => glyph.text);
    assert.equal(text.join(""), "AB CD");
  });

  it("spreads Justify evenly round the whole circle", () => {
    const { glyphs } = layout({ align: "justify" });
    const step = (2 * Math.PI) / 4;
    for (let index = 1; index < glyphs.length; index++) {
      close(glyphs[index].angle - glyphs[index - 1].angle, step);
    }
  });

  it("shrinks to fit once round with Resize to fit, but no smaller than the minimum", () => {
    const text = "A".repeat(100);
    // 100 characters at 20px is 1000px, longer than the 628px circle.
    const fitted = layout({ text, resizeToFit: true });
    close(fitted.fontSize, (20 * 2 * Math.PI * 100) / 1000);
    close(fitted.sweep, 2 * Math.PI);
    assert.equal(layout({ text }).fontSize, 20);
    assert.equal(layout({ text, resizeToFit: true, radius: 10 }).fontSize, 8);
  });
});
