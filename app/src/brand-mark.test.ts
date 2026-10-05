import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const brandMarkTsx = read("./components/BrandMark.tsx");
const logoSvg = read("../public/samples/opening-v2/zvid-logo.svg");
const appCss = read("./App.css");
const brandMarkCss = read("./components/brand-mark.css");
const faviconSvg = read("../public/favicon.svg");

const pathData = (source: string) =>
  [...source.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(([, d]) =>
    d.split(/\s+/).join(" ").trim(),
  );

describe("the top bar's brand mark", () => {
  it("draws the zvid logo, not the five dots", () => {
    const svg = brandMarkTsx.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/)?.[0] ?? "";
    assert.match(svg, /viewBox="-8 -8 258 212"/);
    assert.doesNotMatch(svg, /<circle/);
    assert.deepEqual(pathData(svg), pathData(logoSvg));
    assert.equal(pathData(svg).length, 3);
    // The strips' sprocket holes are cut out of them.
    assert.equal((svg.match(/fillRule="evenodd"/g) ?? []).length, 2);
  });

  it("stays decorative and follows the text color", () => {
    const svg = brandMarkTsx.match(/<svg\b[^>]*>/)?.[0] ?? "";
    assert.match(svg, /aria-hidden="true"/);
    assert.doesNotMatch(brandMarkTsx, /<title|aria-labelledby|role="img"/);
    assert.doesNotMatch(brandMarkTsx, /fill="#/);
    const rule = appCss.match(/\.brand-mark svg \{([^}]*)\}/)?.[1] ?? "";
    assert.match(rule, /fill: currentColor;/);
    assert.match(rule, /height: 20px;/);
    assert.match(rule, /width: auto;/);
  });
});

// WCAG 2 relative luminance of an sRGB #rrggbb color.
function luminance(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

// The body, --bg, the top of the .app-shell gradient, and that gradient
// under its 4% white highlight.
const APP_BACKGROUNDS = ["#232535", "#262839", "#2b2d41", "#2f3145"];

// The color the brand mark resolves to: a literal, or a :root token.
function brandMarkColor(css: string) {
  const rule = css.match(/\.brand-mark \{([^}]*)\}/)?.[1] ?? "";
  const value = rule.match(/(?:^|\s)color: ([^;]+);/)?.[1].trim() ?? "";
  const token = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (!token) return value;
  return (
    css.match(new RegExp(`:root \\{[^}]*${token}: ([^;]+);`))?.[1].trim() ?? ""
  );
}

const passesOnBackgrounds = (color: string) =>
  APP_BACKGROUNDS.every((background) => contrast(color, background) >= 4.5);

describe("the brand purple", () => {
  it("colors the logo at 4.5:1 on the app background", () => {
    const color = brandMarkColor(appCss);
    assert.equal(color, "#b282ff");
    for (const background of APP_BACKGROUNDS) {
      assert.ok(
        contrast(color, background) >= 4.5,
        `${color} on ${background}: ${contrast(color, background).toFixed(2)}:1`,
      );
    }
    // The logo shows the exact color.
    const svgRule = appCss.match(/\.brand-mark svg \{([^}]*)\}/)?.[1] ?? "";
    assert.doesNotMatch(svgRule, /opacity/);
  });

  it("leaves the wordmark in the primary text color", () => {
    const nameRule =
      brandMarkCss.match(/\.brand-mark__name \{([^}]*)\}/)?.[1] ?? "";
    assert.match(nameRule, /(?:^|\s)color: var\(--ink\);/);
  });

  it("rejects the favicon's darker purple on the app background", () => {
    const darker = appCss.replace(
      /--brand-purple: [^;]+;/,
      "--brand-purple: #863bff;",
    );
    assert.equal(brandMarkColor(darker), "#863bff");
    assert.equal(passesOnBackgrounds(brandMarkColor(darker)), false);
  });
});

describe("the favicon", () => {
  it("is the zvid logo in the darker purple, not the bolt", () => {
    assert.match(faviconSvg, /viewBox="-8 -8 258 212"/);
    assert.deepEqual(pathData(faviconSvg), pathData(brandMarkTsx));
    assert.equal((faviconSvg.match(/fill-rule="evenodd"/g) ?? []).length, 2);
    assert.match(faviconSvg, /fill="#863bff"/);
    assert.doesNotMatch(faviconSvg, /<ellipse|<mask|<filter|<rect/);
    assert.doesNotMatch(faviconSvg, /<title|role=|aria-labelledby/);
  });

  it("stands out at 3:1 against a light tab bar", () => {
    const fill = faviconSvg.match(/fill="(#[0-9a-f]{6})"/i)?.[1] ?? "";
    assert.ok(contrast(fill, "#ffffff") >= 3);
  });
});
