import { defineConfig, devices } from "@playwright/test";

// Browser tests of the editor against the web driver (src/web): the Vite
// dev server serves the UI, and with no plugin host the page starts the
// driver itself, so nothing is compiled.
const PORT = 5175;

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
    reuseExistingServer: !process.env.CI,
  },
});
