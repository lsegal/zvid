import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// Component tests (`pnpm test:component`): Vitest browser mode renders
// components in Chromium with their real stylesheets. Unit tests stay on
// `node --test` (test:unit) and the app-level e2e specs on Playwright
// (test:web). See ARCHITECTURE.md (Testing).
export default mergeConfig(
  viteConfig({ command: "serve", mode: "test" }),
  defineConfig({
    // Processes the imported stylesheets instead of stubbing them, so a
    // test sees the styles the app ships.
    css: {},
    test: {
      include: ["src/**/*.component.test.tsx"],
      // Imports the global CSS. Every test depends on it, so a change to
      // global CSS selects the whole suite under `vitest --changed`.
      setupFiles: ["src/component-test/setup.ts"],
      css: { include: /.+/ },
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
        // Matches the desktop layout the e2e specs default to; tests set
        // their own size with setViewport.
        viewport: { width: 1280, height: 720 },
      },
    },
  }),
);
