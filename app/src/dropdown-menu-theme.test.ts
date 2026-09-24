import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Dropdown menus render through a Radix portal outside `.app-shell`, so the
// palette and menu rules must not depend on being inside it.
const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const brandMarkCss = readFileSync(
  new URL("./components/brand-mark.css", import.meta.url),
  "utf8",
);

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("dropdown menu theme", () => {
  it("defines the palette on :root so portaled menus inherit it", () => {
    const root = ruleBody(appCss, ":root");
    for (const name of ["--ink", "--muted", "--line"]) {
      assert.match(root, new RegExp(`${name}:`));
    }
    assert.doesNotMatch(ruleBody(appCss, ".app-shell"), /--ink:/);
  });

  it("matches separators by the role Radix actually renders", () => {
    const separator = ruleBody(
      appCss,
      ".dropdown-menu-content [role='separator']",
    );
    assert.match(separator, /height: 1px;/);
    assert.match(separator, /background: var\(--line\);/);
    assert.doesNotMatch(appCss, /data-radix-dropdown-menu-separator/);
  });

  it("uses the palette for the help menu build line", () => {
    assert.match(
      ruleBody(
        brandMarkCss,
        ".dropdown-menu-content [data-radix-collection-item].help-menu__build",
      ),
      /color: var\(--muted\);/,
    );
  });
});
