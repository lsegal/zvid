import { defineConfig, devices } from "@playwright/test";

// Browser tests of the web harness against the Vite dev server. The export
// bridge must be built first (`wasm-pack build export-bridge ...`).
const PORT = 1422;

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
    reuseExistingServer: !process.env.CI,
  },
});
