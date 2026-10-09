import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(
  new URL("./color-wheel-control.css", import.meta.url),
  "utf8",
);

function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("color wheel disc", () => {
  it("runs its hue gradient to the rim without a light border", () => {
    const disc = ruleBody(".fx-wheel__disc");
    assert.match(disc, /border: 1px solid transparent;/);
    assert.match(disc, /background-origin: border-box;/);
    assert.match(disc, /background-repeat: no-repeat;/);
  });
});
