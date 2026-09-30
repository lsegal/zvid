import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const appCss = read("./App.css");

// Components extracted from App.tsx keep their rules next to them.
const componentStyles = [
  {
    component: "TopBar",
    stylesheet: "top-bar",
    selectors: [
      ".topbar",
      ".file-menu-button",
      ".collaboration-status",
      ".share-button",
      ".share-copy-badge",
    ],
  },
  {
    component: "PreviewPanel",
    stylesheet: "preview-panel",
    selectors: [
      ".preview-panel",
      ".preview-monitor",
      ".preview-placeholder",
      ".preview-resize-handle",
    ],
  },
  {
    component: "FxPanel",
    stylesheet: "fx-panel",
    selectors: [".fx-panel__toggle", ".fx-panel__body"],
  },
  {
    component: "AppDialogs",
    stylesheet: "app-dialogs",
    selectors: [
      ".share-dialog__body",
      ".connect-dialog__input",
      ".collaboration-diagnostics",
      ".workspace-lock-banner",
    ],
  },
];

describe("component stylesheets", () => {
  for (const { component, stylesheet, selectors } of componentStyles) {
    it(`${component} imports and owns ${stylesheet}.css`, () => {
      const tsx = read(`./components/${component}.tsx`);
      const css = read(`./components/${stylesheet}.css`);
      assert.match(tsx, new RegExp(`import "\\./${stylesheet}\\.css";`));
      for (const selector of selectors) {
        const rule = new RegExp(`^\\s*\\${selector}[\\s.:{_-]`, "m");
        assert.match(css, rule, selector);
        assert.doesNotMatch(appCss, rule, selector);
      }
    });
  }

  it("keeps the panel chrome shared by the editor and FX panels in App.css", () => {
    assert.match(appCss, /\.editor-panel,\n\.fx-panel \{/);
  });
});
