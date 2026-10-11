/// <reference types="@vitest/browser-playwright" />

import { cdp, page } from "vitest/browser";

// The desktop size vitest.config.ts opens the page at, Playwright's
// Desktop Chrome.
export const DESKTOP_VIEWPORT = { width: 1280, height: 720 } as const;
// The sizes the e2e specs use: a Pixel 7 either way up, and an iPad Air.
export const PHONE_VIEWPORT = { width: 412, height: 915 } as const;
export const PHONE_LANDSCAPE_VIEWPORT = { width: 915, height: 412 } as const;
export const TABLET_VIEWPORT = { width: 820, height: 1180 } as const;

type Viewport = { readonly width: number; readonly height: number };

let touchEmulated = false;

export async function setViewport({ width, height }: Viewport) {
  await page.viewport(width, height);
}

// Emulates a touch screen: `(pointer: coarse)` and `(hover: none)` match and
// navigator.maxTouchPoints is nonzero, as on a phone or tablet. Chromium
// only.
export async function emulateTouch(enabled = true) {
  await cdp().send(
    "Emulation.setTouchEmulationEnabled",
    enabled ? { enabled, maxTouchPoints: 5 } : { enabled },
  );
  touchEmulated = enabled;
}

// A phone held upright with a touch screen.
export async function usePhone(viewport: Viewport = PHONE_VIEWPORT) {
  await setViewport(viewport);
  await emulateTouch();
}

// A tablet: the desktop layout with a touch screen (coarse-pointer.css).
export async function useTablet(viewport: Viewport = TABLET_VIEWPORT) {
  await setViewport(viewport);
  await emulateTouch();
}

// Chromium headless on Linux has no pointer device, so turning touch
// emulation off leaves `(hover: none)` matching for every later test file.
// `pnpm test:component` runs it headed there (scripts/component-tests.mjs).
const HOVER_STUCK = `(hover: none) still matches after touch emulation turned off.
Headless Chromium on Linux has no pointer device; run the suite with
\`pnpm test:component\`, which runs it headed under xvfb-run. See
app/ARCHITECTURE.md (Testing).`;

// Restores the desktop size and a mouse; the setup file runs it after
// every test.
export async function resetViewport() {
  if (touchEmulated) {
    await emulateTouch(false);
    if (window.matchMedia("(hover: none)").matches) {
      throw new Error(HOVER_STUCK);
    }
  }
  await setViewport(DESKTOP_VIEWPORT);
}
