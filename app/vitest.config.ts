import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import { prebundledDependencies } from "./src/component-test/prebundle.ts";
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

// Every package the browser-side source imports, so the dependency cache
// never misses one mid-run. `*.test.ts` files are node unit tests.
function readSources() {
  return globSync("src/**/*.{ts,tsx}", {
    cwd: import.meta.dirname,
    exclude: (file) => file.endsWith(".test.ts"),
  }).map((file) => readFileSync(path.join(import.meta.dirname, file), "utf8"));
}

const PREBUNDLED = prebundledDependencies(
  readSources(),
  JSON.parse(
    readFileSync(path.join(import.meta.dirname, "package.json"), "utf8"),
  ),
);

export default mergeConfig(
  viteConfig({ command: "serve", mode: "test" }),
  defineConfig({
    server: {
      // The dev server's fixed port doesn't apply: Vitest picks the browser
      // server's port, and moves past one in use by another run.
      strictPort: false,
      // `vitest --changed` walks the tests' imports through the server's
      // ssr environment, whose CSS plugins only initialize when each
      // environment runs its own buildStart.
      perEnvironmentStartEndDuringDev: true,
    },
    optimizeDeps: { include: PREBUNDLED },
    test: {
      include: ["src/**/*.component.test.tsx"],
      // Imports the global CSS; see GLOBAL_TRIGGERS.
      setupFiles: ["src/component-test/setup.ts"],
      forceRerunTriggers: [
        ...configDefaults.forceRerunTriggers,
        ...GLOBAL_TRIGGERS,
      ],
      // Processes every imported stylesheet through Vite rather than
      // stubbing it, so a test sees the styles the app ships.
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
