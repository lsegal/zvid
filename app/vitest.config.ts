import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// Component tests (`pnpm test:component`): Vitest browser mode renders
// components in Chromium with their real stylesheets. Unit tests stay on
// `node --test` (test:unit) and the app-level e2e specs on Playwright
// (test:web). See ARCHITECTURE.md (Testing).
// What every component test depends on: the setup file and the global CSS
// it imports, with the shared tokens. `vitest --changed` follows only the
// tests' own imports, so a change to any of these reruns the whole suite.
const GLOBAL_TRIGGERS = [
  "**/src/component-test/setup.ts",
  "**/src/index.css",
  "**/src/text-fonts.css",
  "**/src/App.css",
  "**/src/coarse-pointer.css",
  "**/packages/tokens/**",
];

export default mergeConfig(
  viteConfig({ command: "serve", mode: "test" }),
  defineConfig({
    // Processes the imported stylesheets instead of stubbing them, so a
    // test sees the styles the app ships.
    css: {},
    server: {
      // `vitest --changed` walks the tests' imports through the server's
      // ssr environment, whose CSS plugins only initialize when each
      // environment runs its own buildStart.
      perEnvironmentStartEndDuringDev: true,
    },
    test: {
      include: ["src/**/*.component.test.tsx"],
      // Imports the global CSS; see GLOBAL_TRIGGERS.
      setupFiles: ["src/component-test/setup.ts"],
      forceRerunTriggers: [
        ...configDefaults.forceRerunTriggers,
        ...GLOBAL_TRIGGERS,
      ],
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
