import { defineConfig, devices } from "@playwright/test";

// Browser tests of the editor against the web driver (src/web): the Vite
// dev server serves the UI, and with no plugin host the page starts the
// driver itself, so nothing is compiled.
//
// PLAYWRIGHT_PORT overrides the dev-server port (default 5175) so parallel
// checkouts can run these tests at once without sharing a server. An
// already-running server on that port is reused only when
// PLAYWRIGHT_REUSE_SERVER=1 is set, and never in CI; otherwise a server from
// another checkout would silently be tested instead of this one.
const PORT = Number(process.env.PLAYWRIGHT_PORT || 5175);
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
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The editor's default size (DEFAULT_SIZE in zvid-daw-ui).
        viewport: { width: 680, height: 760 },
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer:
      !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === "1",
  },
});
