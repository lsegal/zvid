// The app-wide Light/Dark theme (#1488). The choice is kept in local UI
// prefs like the Layers collapse state (layers-section.ts) and applied as
// `data-theme` on the document root, where packages/tokens swaps the palette.
// public/theme-init.js applies a saved light theme before the first paint,
// so loading never flashes the dark one.
import type { ContextMenuItem } from "./context-menu.ts";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "zvid-theme";

// An installed window's title bar color: the top of `.app-shell`, so the
// bar blends into the top bar (index.html's theme-color meta is the dark one).
export const THEME_COLORS: Record<Theme, string> = {
  dark: "#2b2d41",
  light: "#f7f7f9",
};

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

/** The saved theme; dark, the first-run look, when none is saved. */
export function readTheme(storage?: PrefsStorage): Theme {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function writeTheme(storage: PrefsStorage | undefined, theme: Theme) {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode, quota); the switch still
    // applies until the page reloads.
  }
}

/** Sets the theme on the document root and the title bar color. */
export function applyTheme(theme: Theme, doc: Document = document) {
  doc.documentElement.dataset.theme = theme;
  doc
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[theme]);
}

const listeners = new Set<() => void>();

/** The applied theme, read from the root that theme-init.js already set. */
export function getTheme(): Theme {
  return typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

export function setTheme(theme: Theme) {
  writeTheme(globalThis.localStorage, theme);
  applyTheme(theme);
  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The File menu's switch to the other theme. */
export function themeMenuItem(
  theme: Theme,
  onSelect: (theme: Theme) => void,
): ContextMenuItem {
  const other = theme === "dark" ? "light" : "dark";
  return {
    type: "item",
    id: "theme",
    label: other === "light" ? "Light Theme" : "Dark Theme",
    onSelect: () => onSelect(other),
  };
}
