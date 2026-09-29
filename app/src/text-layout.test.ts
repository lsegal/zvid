import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  layoutText,
  type TextLayoutOptions,
  type TextMeasure,
  wrapText,
} from "./text-layout.ts";

// Every character is half an em wide, so widths are easy to work out.
const measure: TextMeasure = (text, fontSize) =>
  Array.from(text).length * fontSize * 0.5;

function options(overrides: Partial<TextLayoutOptions> = {}) {
  return {
    text: "Hello world",
    fontSize: 20,
    minFontSize: 8,
    resizeToFit: false,
    lineHeight: 1,
    letterSpacing: 0,
    align: "left",
    verticalAlign: "top",
    width: 200,
    height: 100,
    padding: 0,
    ...overrides,
  } satisfies TextLayoutOptions;
}

const lineTexts = (overrides: Partial<TextLayoutOptions>) =>
  layoutText(options(overrides), measure).lines.map((line) => line.text);

describe("wrapText", () => {
  // 5px per character.
  const width = (text: string) => measure(text, 10);

  it("wraps words at the width and keeps line breaks", () => {
    assert.deepEqual(
      wrapText("one two three\nfour", 30, width).map((line) => [
        line.text,
        line.paragraphEnd,
      ]),
      [
        ["one", false],
        ["two", false],
        ["three", true],
        ["four", true],
      ],
    );
  });

  it("keeps empty lines", () => {
    assert.deepEqual(
      wrapText("a\n\nb", 100, width).map((line) => line.text),
      ["a", "", "b"],
    );
  });

  it("breaks a word wider than the line", () => {
    assert.deepEqual(
      wrapText("abcdefgh", 30, width).map((line) => line.text),
      ["abcdef", "gh"],
    );
  });
});

describe("layoutText", () => {
  it("wraps at the box width less its padding", () => {
    // "Hello world" is eleven 10px characters.
    assert.deepEqual(lineTexts({ width: 100 }), ["Hello", "world"]);
    assert.deepEqual(lineTexts({ width: 110 }), ["Hello world"]);
    assert.deepEqual(lineTexts({ width: 130, padding: 10 }), ["Hello world"]);
    assert.deepEqual(lineTexts({ width: 120, padding: 10 }), [
      "Hello",
      "world",
    ]);
  });

  it("aligns lines left, centre and right", () => {
    const x = (align: TextLayoutOptions["align"]) =>
      layoutText(options({ align, text: "Hi" }), measure).lines[0].x;
    // "Hi" is 20px wide in a 200px box.
    assert.equal(x("left"), 0);
    assert.equal(x("center"), 90);
    assert.equal(x("right"), 180);
    assert.equal(
      layoutText(options({ align: "right", text: "Hi", padding: 10 }), measure)
        .lines[0].x,
      170,
    );
  });

  it("justifies every line but a paragraph's last", () => {
    const layout = layoutText(
      options({ align: "justify", width: 100, text: "aa bb cc dd" }),
      measure,
    );
    // "aa bb cc" fits 80px of 100px; its two gaps share the rest.
    assert.deepEqual(
      layout.lines.map((line) => line.text),
      ["aa bb cc", "dd"],
    );
    assert.deepEqual(layout.lines[0].words, [
      { text: "aa", x: 0 },
      { text: "bb", x: 40 },
      { text: "cc", x: 80 },
    ]);
    assert.equal(layout.lines[1].words, undefined);
    assert.equal(layout.lines[1].x, 0);
  });

  it("places the block at the top, middle or bottom", () => {
    const top = (verticalAlign: TextLayoutOptions["verticalAlign"]) =>
      layoutText(options({ verticalAlign, lineHeight: 1.5 }), measure).lines[0]
        .y;
    // One 30px line in a 100px box.
    assert.equal(top("top"), 0);
    assert.equal(top("middle"), 35);
    assert.equal(top("bottom"), 70);
  });

  it("spaces letters by ems of the font size", () => {
    const layout = layoutText(
      options({ text: "abc", letterSpacing: 0.5 }),
      measure,
    );
    // 30px of characters and two 10px gaps.
    assert.equal(layout.lines[0].width, 50);
  });

  it("keeps the size and clips overflow with Resize to fit off", () => {
    const layout = layoutText(
      options({ text: "one two three four five six", width: 60, height: 40 }),
      measure,
    );
    assert.equal(layout.fontSize, 20);
    assert.equal(layout.fits, false);
  });

  describe("Resize to fit", () => {
    const long = "The quick brown fox jumps over the lazy dog";

    it("shrinks the text until it fits the box", () => {
      const layout = layoutText(
        options({ text: long, resizeToFit: true, fontSize: 96 }),
        measure,
      );
      assert.ok(layout.fits);
      assert.ok(layout.fontSize < 96);
      const height = layout.lines.length * layout.lineHeight;
      assert.ok(height <= 100);
      assert.ok(layout.lines.every((line) => line.width <= 200));
      // As large as fits: a step up no longer does.
      const larger = layoutText(
        options({
          text: long,
          fontSize: layout.fontSize + 0.5,
          resizeToFit: false,
        }),
        measure,
      );
      assert.equal(larger.fits, false);
    });

    it("never grows past the chosen size", () => {
      const layout = layoutText(
        options({ text: "Hi", resizeToFit: true, fontSize: 24 }),
        measure,
      );
      assert.equal(layout.fontSize, 24);
      assert.ok(layout.fits);
    });

    it("stops at the minimum size and clips", () => {
      const layout = layoutText(
        options({
          text: long.repeat(20),
          resizeToFit: true,
          fontSize: 96,
          minFontSize: 8,
          width: 50,
          height: 20,
        }),
        measure,
      );
      assert.equal(layout.fontSize, 8);
      assert.equal(layout.fits, false);
    });

    it("fits inside the padding", () => {
      const padded = layoutText(
        options({ text: long, resizeToFit: true, fontSize: 96, padding: 20 }),
        measure,
      );
      const unpadded = layoutText(
        options({ text: long, resizeToFit: true, fontSize: 96 }),
        measure,
      );
      assert.ok(padded.fontSize < unpadded.fontSize);
      assert.ok(padded.lines.every((line) => line.x >= 20));
      assert.ok(padded.lines[0].y >= 20);
    });
  });
});
