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
    assert.match(root, /--brand-purple: #863bff;/);
    assert.match(
      appCss,
      /@supports \(color: color\(display-p3 0 0 0\)\) \{\s*:root \{\s*--brand-purple: color\(display-p3 0\.5252 0\.23 1\);/,
    );
    const mark = brandMarkCss.match(/\.brand-mark \{([^}]*)\}/)?.[1] ?? "";
    assert.match(mark, /color: var\(--brand-purple\);/);
    const name =
      brandMarkCss.match(/\.brand-mark__name \{([^}]*)\}/)?.[1] ?? "";
    assert.doesNotMatch(name, /color:/);
    const rule = brandMarkCss.match(/\.brand-mark svg \{([^}]*)\}/)?.[1] ?? "";
    assert.doesNotMatch(rule, /opacity/);
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
