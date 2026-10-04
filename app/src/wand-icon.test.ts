import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const transportBarTsx = read("./components/timeline/TransportBar.tsx");
const emptyStateTsx = read("./components/ArrangementEmptyState.tsx");
const appCss = read("./App.css");

describe("the wand icon", () => {
  it("is Heroicons' solid sparkles icon in both places", () => {
    for (const tsx of [transportBarTsx, emptyStateTsx]) {
      assert.match(
        tsx,
        /import \{[^}]*\bSparklesIcon\b[^}]*\} from "@heroicons\/react\/24\/solid";/,
      );
      assert.match(tsx, /<SparklesIcon aria-hidden="true" \/>/);
      assert.doesNotMatch(tsx, /WandIcon/);
    }
  });

  it("is not a custom-drawn icon", () => {
    assert.equal(
      existsSync(new URL("./components/WandIcon.tsx", import.meta.url)),
      false,
    );
  });

  it("draws at the same size as the other transport icons", () => {
    const wandRule = appCss.match(/\.transport-button--wand svg \{([^}]*)\}/);
    assert.ok(wandRule);
    assert.doesNotMatch(wandRule[1], /\b(width|height):/);
  });
});
