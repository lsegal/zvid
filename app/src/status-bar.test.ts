import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { partitionStatusItems } from "./status-bar.ts";

const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("status bar items", () => {
  it("defaults items to the start group", () => {
    const { start, end } = partitionStatusItems([
      { id: "a", value: "A" },
      { id: "b", value: "B", align: "start" },
    ]);
    assert.deepEqual(
      start.map((item) => item.id),
      ["a", "b"],
    );
    assert.deepEqual(end, []);
  });

  it("keeps the original order within each group", () => {
    const { start, end } = partitionStatusItems([
      { id: "a", value: "A", align: "end" },
      { id: "b", value: "B" },
      { id: "c", value: "C", align: "end" },
      { id: "d", value: "D" },
    ]);
    assert.deepEqual(
      start.map((item) => item.id),
      ["b", "d"],
    );
    assert.deepEqual(
      end.map((item) => item.id),
      ["a", "c"],
    );
  });
});

describe("status bar layout", () => {
  it("is mounted after the workspace so it docks at the bottom", () => {
    const workspaceEnd = appTsx.lastIndexOf("</main>");
    const statusBar = appTsx.indexOf("<StatusBar ");
    assert.notEqual(statusBar, -1);
    assert.ok(statusBar > workspaceEnd);
  });

  it("keeps a fixed compact height that the shell cannot stretch", () => {
    const bar = ruleBody(appCss, ".status-bar");
    const height = Number(/\bheight: (\d+)px;/.exec(bar)?.[1]);
    assert.ok(height > 0 && height <= 26, `height ${height}px`);
    assert.match(bar, /flex: none;/);
    assert.match(bar, /white-space: nowrap;/);
    assert.match(bar, /overflow: hidden;/);
  });

  it("truncates items with an ellipsis instead of wrapping", () => {
    for (const selector of [".status-bar__item", ".status-bar__value"]) {
      assert.match(ruleBody(appCss, selector), /text-overflow: ellipsis;/);
    }
    assert.match(
      ruleBody(appCss, ".status-bar__item + .status-bar__item"),
      /border-left: 1px solid var\(--line\);/,
    );
  });
});
