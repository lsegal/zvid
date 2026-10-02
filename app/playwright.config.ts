import { defineConfig, devices } from "@playwright/test";

// Browser tests of the web harness against the Vite dev server. The export
// bridge must be built first (`wasm-pack build export-bridge ...`).
//
// PLAYWRIGHT_PORT overrides the dev-server port (default 1422) so parallel
// checkouts can run these tests at once without sharing a server. An
// already-running server on that port is reused only when
// PLAYWRIGHT_REUSE_SERVER=1 is set, and never in CI; otherwise a server from
// another checkout would silently be tested instead of this one.
const PORT = Number(process.env.PLAYWRIGHT_PORT || 1422);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  throw new Error(`Invalid PLAYWRIGHT_PORT: ${process.env.PLAYWRIGHT_PORT}`);
}

// CI runs the suite on main only, as 16 shards on separate runners
// (.github/workflows/ci.yml). Each runner has 4 vCPUs and each worker drives
// a Chromium against the dev server and the wasm bridge, so CI uses two
// workers per shard. The shards take tests from any file, and fullyParallel
// spreads a file's tests over the workers, so every test must be safe to run
// concurrently with any other.
//
// In CI the blob reporter writes blob-report/ for `playwright merge-reports`,
// and the JSON reporter writes e2e-results.json for scripts/e2e-summary.mjs.
export default defineConfig({
  testDir: "e2e",
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
    baseURL: `http://localhost:${PORT}/`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/export-smoke.html`,
    reuseExistingServer:
      !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === "1",
  },
});
