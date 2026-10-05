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
const indexHtml = read("../index.html");

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
    const rule = brandMarkCss.match(/\.brand-mark svg \{([^}]*)\}/)?.[1] ?? "";
    assert.match(rule, /fill: currentColor;/);
    assert.match(rule, /height: 20px;/);
    assert.match(rule, /width: auto;/);
  });

  it("is the brand purple, at full opacity", () => {
    const root = appCss.match(/:root \{([^}]*)\}/)?.[1] ?? "";
    assert.match(root, /--brand-purple: #b282ff;/);
    // A wide-gamut override must not darken it below the contrast floor.
    assert.doesNotMatch(appCss, /--brand-purple: color\(/);
    const mark = brandMarkCss.match(/\.brand-mark \{([^}]*)\}/)?.[1] ?? "";
    assert.match(mark, /color: var\(--brand-purple\);/);
    const name =
      brandMarkCss.match(/\.brand-mark__name \{([^}]*)\}/)?.[1] ?? "";
    assert.doesNotMatch(name, /color:/);
    const rule = brandMarkCss.match(/\.brand-mark svg \{([^}]*)\}/)?.[1] ?? "";
    assert.doesNotMatch(rule, /opacity/);
  });
});

// WCAG 2 contrast ratio of two sRGB hex colors.
const luminance = (hex: string) => {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
// The body, --bg, the top of the .app-shell gradient, and that under its 4%
// white highlight.
const TOP_BAR_BACKGROUNDS = ["#232535", "#262839", "#2b2d41", "#2f3145"];
const passesTopBar = (color: string) =>
  TOP_BAR_BACKGROUNDS.every((background) => contrast(color, background) >= 4.5);

describe("the brand purple's contrast (#1087)", () => {
  it("passes 4.5:1 for the wordmark on every top bar background", () => {
    const color = appCss.match(/--brand-purple: (#[0-9a-f]{6});/)?.[1] ?? "";
    assert.equal(passesTopBar(color), true);
    // The favicon's darker purple would fail there.
    assert.equal(passesTopBar("#863bff"), false);
  });

  it("passes 3:1 for the favicon against a white tab bar", () => {
    const fill = faviconSvg.match(/<svg\b[^>]*\bfill="(#[0-9a-f]{6})"/)?.[1];
    assert.equal(fill, "#863bff");
    assert.ok(contrast(fill ?? "", "#ffffff") >= 3);
    // The lighter top bar purple would fail there.
    assert.ok(contrast("#b282ff", "#ffffff") < 3);
  });
});

describe("the favicon", () => {
  it("is the zvid logo in the brand purple, not the bolt", () => {
    assert.match(
      indexHtml,
      /<link rel="icon" type="image\/svg\+xml" href="\/favicon.svg" \/>/,
    );
    const root = faviconSvg.match(/<svg\b[^>]*>/)?.[0] ?? "";
    assert.match(root, /viewBox="-8 -8 258 212"/);
    assert.match(root, /fill="#863bff"/);
    assert.match(
      root,
      /style="fill:#863bff;fill:color\(display-p3 \.5252 \.23 1\)"/,
    );
    assert.deepEqual(pathData(faviconSvg), pathData(logoSvg));
    assert.equal((faviconSvg.match(/fill-rule="evenodd"/g) ?? []).length, 2);
    // No per-path fills, glow ellipses, or accessible name.
    assert.equal((faviconSvg.match(/\bfill="/g) ?? []).length, 1);
    assert.doesNotMatch(
      faviconSvg,
      /<ellipse|<mask|<filter|<title|role=|aria-labelledby/,
    );
  });
});
