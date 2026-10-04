import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const wandIconTsx = readFileSync(
  new URL("./components/WandIcon.tsx", import.meta.url),
  "utf8",
);
const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");

describe("the wand icon", () => {
  it("is a stroked outline icon, so its diagonal shaft does not alias", () => {
    assert.match(wandIconTsx, /viewBox="0 0 24 24"/);
    assert.match(wandIconTsx, /fill="none"/);
    assert.match(wandIconTsx, /stroke="currentColor"/);
    assert.match(wandIconTsx, /strokeLinecap="round"/);
    assert.match(wandIconTsx, /strokeLinejoin="round"/);
    assert.match(wandIconTsx, /aria-hidden="true"/);
    assert.doesNotMatch(wandIconTsx, /fill="currentColor"/);
  });

  it("draws at the same size as the other transport icons", () => {
    const wandRule = appCss.match(/\.transport-button--wand svg \{([^}]*)\}/);
    assert.ok(wandRule);
    assert.doesNotMatch(wandRule[1], /\b(width|height):/);
  });
});
