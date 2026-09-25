import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// /app and daw/ui share one set of tokens and bundled fonts from
// packages/tokens (daw/DESIGN.md), so neither product loads fonts from the
// network and the two cannot drift.
const tokensUrl = new URL("../../packages/tokens/tokens.css", import.meta.url);
const tokensCss = readFileSync(tokensUrl, "utf8");
const indexCss = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");

const sharedTokens = [
  "--bg",
  "--bg-elevated",
  "--bg-panel",
  "--bg-soft",
  "--ink",
  "--muted",
  "--ink-on-accent",
  "--line",
  "--line-strong",
  "--pink",
  "--mint",
  "--amber",
  "--blue",
];

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

function appStylesheets(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return appStylesheets(new URL(`${entry.name}/`, dir));
    }
    return entry.name.endsWith(".css")
      ? [readFileSync(new URL(entry.name, dir), "utf8")]
      : [];
  });
}

describe("shared design tokens", () => {
  it("defines every shared token on :root in the tokens package", () => {
    const root = ruleBody(tokensCss, ":root");
    for (const name of sharedTokens) {
      assert.match(root, new RegExp(`${name}:`), `missing ${name}`);
    }
    assert.match(root, /--ink-on-accent: #0f1220;/);
  });

  it("imports the tokens package instead of redefining shared tokens", () => {
    assert.match(indexCss, /@import '@zvid\/tokens\/tokens\.css';/);
    for (const name of sharedTokens) {
      assert.doesNotMatch(appCss, new RegExp(`^s*${name}:`, "m"), name);
    }
    assert.match(ruleBody(appCss, ":root"), /--lane-selected-accent:/);
  });

  it("bundles every font face locally", () => {
    const sources = [...tokensCss.matchAll(/src: url\('([^']+)'\)/g)].map(
      (match) => match[1],
    );
    assert.equal(sources.length, 12);
    for (const source of sources) {
      assert.match(source, /^\.\/fonts\/[\w-]+\.woff2$/);
      assert.ok(existsSync(new URL(source, tokensUrl)), `missing ${source}`);
    }
    for (const [family, weights] of [
      ["Space Grotesk", [400, 500, 700]],
      ["IBM Plex Mono", [400, 500, 600]],
    ] as const) {
      for (const weight of weights) {
        const faces = tokensCss
          .split("@font-face")
          .filter(
            (face) =>
              face.includes(`font-family: '${family}';`) &&
              face.includes(`font-weight: ${weight};`),
          );
        assert.equal(faces.length, 2, `${family} ${weight}`);
      }
    }
  });

  it("loads no stylesheets or fonts from the network", () => {
    for (const css of [
      tokensCss,
      ...appStylesheets(new URL("./", import.meta.url)),
    ]) {
      assert.doesNotMatch(css, /url\(\s*['"]?(https?:)?\/\//);
      assert.doesNotMatch(css, /@import\s+url\(/);
    }
  });

  it("uses the accent ink token instead of a hard-coded colour", () => {
    for (const css of appStylesheets(new URL("./", import.meta.url))) {
      assert.doesNotMatch(css, /#0f1220/i);
    }
  });
});
