import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// UI text isn't selectable; only text fields are (#865). The root rule in
// index.css does this once, so components shouldn't repeat it.
const indexCss = readFileSync(new URL("./index.css", import.meta.url), "utf8");

// Rules that turn selection off for everything during a drag, inputs
// included, which the root rule can't do.
const DRAG_RULES = new Set([
  "components/fx/fx-chain.css",
  "components/timeline/arrangement-lanes.css",
  "components/timeline/timeline.css",
]);

describe("text selection", () => {
  it("turns selection off at the root", () => {
    const start = indexCss.indexOf(":root {\n  -webkit-user-select: none;");
    assert.notEqual(start, -1);
    assert.match(
      indexCss.slice(start, indexCss.indexOf("}", start)),
      /\n {2}user-select: none;/,
    );
  });

  it("turns it back on only for text fields, without specificity", () => {
    const start = indexCss.indexOf(":where(");
    assert.notEqual(start, -1);
    const rule = indexCss.slice(start, indexCss.indexOf("}", start));
    assert.match(rule, /textarea/);
    for (const type of ["checkbox", "radio", "range", "color", "file"]) {
      assert.match(rule, new RegExp(`\[type='${type}'\]`));
    }
    assert.match(rule, /-webkit-user-select: text;/);
    assert.match(rule, /\n {2}user-select: text;/);
  });

  it("leaves per-component rules only for drag states", () => {
    const files = readdirSync(new URL("./components", import.meta.url), {
      recursive: true,
    })
      .map((file) => String(file).replaceAll("\\", "/"))
      .filter((file) => file.endsWith(".css"));
    const withRules = files
      .filter((file) =>
        /user-select:/.test(
          readFileSync(
            new URL(`./components/${file}`, import.meta.url),
            "utf8",
          ),
        ),
      )
      .map((file) => `components/${file}`);
    assert.deepEqual(new Set(withRules), DRAG_RULES);
  });
});
