import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FONT_FAMILY,
  formatFontChoice,
  formatFontSpec,
  getFontWeightLabels,
  googleFontsCssUrl,
  nearestFontWeight,
  parseFontChoice,
  resolveFontFace,
} from "./text-fonts.ts";
import {
  formatStyleFlags,
  getTextPreview,
  parseStyleFlags,
  readTextStyle,
  resolveTextStyle,
  toggleStyleFlag,
} from "./text-style.ts";

function textEffect(
  parameters: Array<{ key: string; value: string; numericValue?: number }>,
  overrides: { trackId?: string; enabled?: boolean } = {},
) {
  return {
    trackId: "1",
    effectName: "Text",
    parameters,
    ...overrides,
  };
}

describe("readTextStyle", () => {
  it("reads the last enabled Text effect on the layer", () => {
    const effects = [
      textEffect([{ key: "Text", value: "first" }]),
      textEffect([{ key: "Text", value: "second" }]),
      textEffect([{ key: "Text", value: "bypassed" }], { enabled: false }),
      textEffect([{ key: "Text", value: "other layer" }], { trackId: "2" }),
    ];
    assert.equal(resolveTextStyle(effects, "1").text, "second");
    assert.equal(resolveTextStyle([], "1").text, "Text");
  });

  it("clamps sizes to their ranges", () => {
    const style = readTextStyle(
      textEffect([
        { key: "FontSize", value: "9000" },
        { key: "LineHeight", value: "0.1" },
        { key: "Padding", value: "-5" },
      ]),
    );
    assert.equal(style.fontSize, 600);
    assert.equal(style.lineHeight, 0.6);
    assert.equal(style.padding, 0);
  });

  it("makes Bold a shortcut for weight 700", () => {
    const style = readTextStyle(
      textEffect([
        { key: "FontWeight", value: "Light" },
        { key: "FontStyle", value: "Bold" },
      ]),
    );
    assert.equal(style.weight, 700);
    // Bebas Neue only has a regular weight.
    assert.equal(
      readTextStyle(
        textEffect([
          { key: "FontFamily", value: "Bebas Neue" },
          { key: "FontStyle", value: "Bold" },
        ]),
      ).weight,
      400,
    );
  });

  it("falls back to a solid fill for an unreadable gradient", () => {
    const style = readTextStyle(
      textEffect([
        { key: "FillMode", value: "Gradient" },
        { key: "Gradient", value: "nonsense" },
        { key: "Color", value: "#ff0000" },
      ]),
    );
    assert.deepEqual(style.paint, {
      kind: "solid",
      color: { r: 255, g: 0, b: 0, a: 1 },
    });
  });

  it("only strokes with a width", () => {
    assert.equal(
      readTextStyle(textEffect([{ key: "Stroke", value: "#000" }])).stroke,
      undefined,
    );
  });
});

describe("style flags", () => {
  it("parses and formats in toolbar order", () => {
    assert.deepEqual(
      [...parseStyleFlags("underline, BOLD, nonsense")],
      ["Underline", "Bold"],
    );
    assert.equal(
      formatStyleFlags(new Set(["AllCaps", "Italic", "Bold"])),
      "Bold,Italic,AllCaps",
    );
  });

  it("toggles one flag", () => {
    assert.equal(toggleStyleFlag("", "Italic"), "Italic");
    assert.equal(toggleStyleFlag("Bold,Italic", "Bold"), "Italic");
    assert.equal(toggleStyleFlag("Italic", "Bold"), "Bold,Italic");
  });
});

describe("getTextPreview", () => {
  it("shows the first non-empty line, in caps with All caps", () => {
    assert.equal(
      getTextPreview({ text: "\n  Hello  \nWorld", allCaps: false }),
      "Hello",
    );
    assert.equal(getTextPreview({ text: "hi", allCaps: true }), "HI");
    assert.equal(getTextPreview({ text: "", allCaps: false }), "");
  });
});

describe("fonts", () => {
  it("stores Google and local fonts with their source", () => {
    assert.deepEqual(parseFontChoice("google:Roboto Slab"), {
      source: "google",
      family: "Roboto Slab",
    });
    assert.deepEqual(parseFontChoice("local:Arial"), {
      source: "local",
      family: "Arial",
    });
    assert.deepEqual(parseFontChoice("Anton"), {
      source: "bundled",
      family: "Anton",
    });
    assert.deepEqual(parseFontChoice(""), {
      source: "bundled",
      family: DEFAULT_FONT_FAMILY,
    });
    assert.equal(
      formatFontChoice({ source: "google", family: "Lato" }),
      "google:Lato",
    );
  });

  it("lists every weight for fonts that aren't bundled", () => {
    assert.equal(getFontWeightLabels("google:Lato").length, 9);
    assert.deepEqual(getFontWeightLabels("Anton"), ["Regular"]);
  });

  it("picks the nearest available weight, heavier on a tie", () => {
    assert.equal(nearestFontWeight(900, [400, 500, 700]), 700);
    assert.equal(nearestFontWeight(600, [400, 500, 700]), 700);
    assert.equal(nearestFontWeight(100, [400, 500, 700]), 400);
  });

  it("draws bundled fonts with the family their faces register", () => {
    const face = resolveFontFace("Inter", 700, true, new Set());
    assert.equal(face.cssFamily, "Inter Variable");
    assert.equal(
      formatFontSpec(face, 24),
      'italic 700 24px "Inter Variable", sans-serif',
    );
  });

  it("falls back to the default font when the chosen one is missing", () => {
    const missing = new Set(["google:Not A Font"]);
    const face = resolveFontFace("google:Not A Font", 900, false, missing);
    assert.equal(face.value, DEFAULT_FONT_FAMILY);
    assert.equal(face.cssFamily, "Inter Variable");
    assert.equal(face.weight, 900);
    assert.equal(
      resolveFontFace("google:Roboto", 400, false, missing).cssFamily,
      "Roboto",
    );
  });

  it("asks Google Fonts for the exact face", () => {
    assert.equal(
      googleFontsCssUrl(["Roboto Slab"], {
        value: "google:Roboto Slab",
        cssFamily: "Roboto Slab",
        weight: 700,
        italic: true,
      }),
      "https://fonts.googleapis.com/css2?family=Roboto+Slab:ital,wght@1,700&display=swap",
    );
    assert.equal(
      googleFontsCssUrl(["Lato", "Open Sans"]),
      "https://fonts.googleapis.com/css2?family=Lato&family=Open+Sans&display=swap",
    );
  });
});
