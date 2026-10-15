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
  "--selection-ring",
];

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

function tokenValue(rule: string, name: string) {
  const value = rule.match(new RegExp(`${name}: (#[0-9a-f]{6});`))?.[1];
  assert.ok(value, `${name} is not a hex color`);
  return value;
}

// WCAG relative luminance and contrast ratio of two hex colors.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
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
    const root = ruleBody(tokensCss, ":root,\n[data-theme='dark']");
    for (const name of sharedTokens) {
      assert.match(root, new RegExp(`${name}:`), `missing ${name}`);
    }
    assert.match(root, /--ink-on-accent: #0f1220;/);
  });

  it("redefines every color token for the light theme", () => {
    const light = ruleBody(tokensCss, "[data-theme='light']");
    assert.match(light, /color-scheme: light;/);
    for (const name of [...sharedTokens, "--tint", "--waveform"]) {
      assert.match(light, new RegExp(`${name}:`), `missing ${name}`);
    }
  });

  it("keeps light-theme text and accents readable", () => {
    const light = ruleBody(tokensCss, "[data-theme='light']");
    const surfaces = ["--bg", "--bg-elevated", "--bg-panel", "--bg-soft"];
    for (const surface of surfaces.map((name) => tokenValue(light, name))) {
      for (const [name, min] of [
        ["--ink", 4.5],
        ["--muted", 4.5],
        ["--amber", 3.5],
        ["--pink", 3.5],
        ["--blue", 3.5],
        ["--mint", 3.5],
      ] as const) {
        const ratio = contrast(tokenValue(light, name), surface);
        assert.ok(ratio >= min, `${name} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    const onAccent = tokenValue(light, "--ink-on-accent");
    for (const name of ["--amber", "--pink", "--blue", "--mint"]) {
      const ratio = contrast(tokenValue(light, name), onAccent);
      assert.ok(ratio >= 3, `--ink-on-accent on ${name}: ${ratio.toFixed(2)}`);
    }
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

  it("uses the accent ink token instead of a hard-coded color", () => {
    for (const css of appStylesheets(new URL("./", import.meta.url))) {
      assert.doesNotMatch(css, /#0f1220/i);
    }
  });
});
