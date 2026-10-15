import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  applyTheme,
  readTheme,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  writeTheme,
} from "./theme.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

// The document root and theme-color meta that applyTheme and
// theme-init.js touch.
function fakeDocument() {
  const meta = { content: "#2b2d41" };
  const root = { dataset: {} as Record<string, string> };
  return {
    meta,
    documentElement: root,
    querySelector: (selector: string) =>
      selector === 'meta[name="theme-color"]'
        ? {
            setAttribute: (_name: string, value: string) => {
              meta.content = value;
            },
          }
        : null,
  };
}

const initScript = readFileSync(
  new URL("../public/theme-init.js", import.meta.url),
  "utf8",
);

describe("theme", () => {
  it("persists the theme, starting dark", () => {
    const storage = memoryStorage();
    assert.equal(readTheme(storage), "dark");
    writeTheme(storage, "light");
    assert.equal(storage.getItem(THEME_STORAGE_KEY), "light");
    assert.equal(readTheme(storage), "light");
    writeTheme(storage, "dark");
    assert.equal(readTheme(storage), "dark");
  });

  it("starts dark when storage is unavailable", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readTheme(broken), "dark");
    assert.doesNotThrow(() => writeTheme(broken, "light"));
    assert.equal(readTheme(undefined), "dark");
  });

  it("sets the root's theme and the title bar color", () => {
    const doc = fakeDocument();
    applyTheme("light", doc as unknown as Document);
    assert.equal(doc.documentElement.dataset.theme, "light");
    assert.equal(doc.meta.content, THEME_COLORS.light);
    applyTheme("dark", doc as unknown as Document);
    assert.equal(doc.documentElement.dataset.theme, "dark");
    assert.equal(doc.meta.content, THEME_COLORS.dark);
  });

  it("applies a saved light theme before the app loads", () => {
    for (const saved of [null, "dark", "light"]) {
      const storage = memoryStorage();
      if (saved) writeTheme(storage, saved === "light" ? "light" : "dark");
      const document = fakeDocument();
      runInNewContext(initScript, { localStorage: storage, document });
      const expected = readTheme(storage);
      assert.equal(
        document.documentElement.dataset.theme ?? "dark",
        expected,
        `saved ${saved}`,
      );
      assert.equal(document.meta.content, THEME_COLORS[expected]);
    }
  });

  it("leaves the first paint dark when storage throws", () => {
    const document = fakeDocument();
    const localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    runInNewContext(initScript, { localStorage, document });
    assert.equal(document.documentElement.dataset.theme, undefined);
  });
});
