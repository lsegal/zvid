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

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
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
