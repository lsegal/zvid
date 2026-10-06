import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Browser tests of the web harness. The export bridge must be built first
// (`wasm-pack build export-bridge ...`).
//
// PLAYWRIGHT_SERVER picks what they run against: "preview" (the default)
// serves a production build (`vite build --mode e2e`, into dist-e2e), which
// loads several times faster than the dev server; "dev" runs every test on
// the Vite dev server. PLAYWRIGHT_SKIP_BUILD=1 previews the existing
// dist-e2e as is.
//
// Specs that import app modules straight from /src in the page (the
// compositor and meter checks) need the dev server to compile them, so in
// preview mode they run on a dev server beside the preview, on the next port.
//
// PLAYWRIGHT_PORT overrides the first server's port (default 1422) so
// parallel checkouts can run these tests at once without sharing a server.
// An already-running server is reused only when PLAYWRIGHT_REUSE_SERVER=1 is
// set, and never in CI; otherwise a server from another checkout would
// silently be tested instead of this one.
const PORT = Number(process.env.PLAYWRIGHT_PORT || 1422);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT >= 65535) {
  throw new Error(`Invalid PLAYWRIGHT_PORT: ${process.env.PLAYWRIGHT_PORT}`);
}
const DEV_PORT = PORT + 1;

const SERVER = process.env.PLAYWRIGHT_SERVER || "preview";
if (SERVER !== "dev" && SERVER !== "preview") {
  throw new Error(`Invalid PLAYWRIGHT_SERVER: ${SERVER}`);
}

const TEST_DIR = path.join(import.meta.dirname, "e2e");

// The specs that load /src modules in the page.
const SOURCE_MODULE_SPECS = readdirSync(TEST_DIR).filter(
  (file) =>
    file.endsWith(".spec.ts") &&
    readFileSync(path.join(TEST_DIR, file), "utf8").includes('"/src/'),
);

const reuseExistingServer =
  !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === "1";

function devServer(port: number) {
  return {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/export-smoke.html`,
    reuseExistingServer,
  };
}

const PREVIEW = `pnpm exec vite preview --mode e2e --port ${PORT} --strictPort`;
const previewServer = {
  command:
    process.env.PLAYWRIGHT_SKIP_BUILD === "1"
      ? PREVIEW
      : `pnpm exec vite build --mode e2e && ${PREVIEW}`,
  url: `http://localhost:${PORT}/export-smoke.html`,
  // The preview builds the app first.
  timeout: 180_000,
  reuseExistingServer,
};

const chromium = devices["Desktop Chrome"];

// Specs that also run in WebKit, the engine of Safari and every iOS browser
// (#1111). The WebKit project is opt-in, with PLAYWRIGHT_WEBKIT=1, since
// only CI's e2e-webkit job installs WebKit.
const WEBKIT_SPECS = ["audio-resync.spec.ts"];
const webkitProjects =
  process.env.PLAYWRIGHT_WEBKIT === "1"
    ? [
        {
          name: "webkit",
          testMatch: WEBKIT_SPECS,
          use: {
            ...devices["Desktop Safari"],
            baseURL: `http://localhost:${PORT}/`,
          },
        },
      ]
    : [];

// CI runs the suite on main only, as 16 shards on separate runners
// (.github/workflows/ci.yml). Each runner has 4 vCPUs and each worker drives
// a Chromium against the app and the wasm bridge, so CI uses two
// workers per shard. The shards take tests from any file, and fullyParallel
// spreads a file's tests over the workers, so every test must be safe to run
// concurrently with any other.
//
// In CI the blob reporter writes blob-report/ for `playwright merge-reports`,
// and the JSON reporter writes e2e-results.json for scripts/e2e-summary.mjs.
export default defineConfig({
  testDir: TEST_DIR,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["list"],
        ["github"],
        ["blob"],
        ["json", { outputFile: "e2e-results.json" }],
      ]
    : "list",
  use: {
    trace: "retain-on-failure",
  },
  projects:
    SERVER === "dev"
      ? [
          {
            name: "chromium",
            use: { ...chromium, baseURL: `http://localhost:${PORT}/` },
          },
          ...webkitProjects,
        ]
      : [
          {
            name: "chromium",
            testIgnore: SOURCE_MODULE_SPECS,
            use: { ...chromium, baseURL: `http://localhost:${PORT}/` },
          },
          {
            name: "chromium-source-modules",
            testMatch: SOURCE_MODULE_SPECS,
            use: { ...chromium, baseURL: `http://localhost:${DEV_PORT}/` },
          },
          ...webkitProjects,
        ],
  webServer:
    SERVER === "dev" ? devServer(PORT) : [previewServer, devServer(DEV_PORT)],
});
