import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const root = import.meta.dirname;

// The landing page is the site's index.html; the docs overview is
// help/index.html, and every guide is a folder of its own under help/.
const helpPages = Object.fromEntries(
  readdirSync(path.join(root, "help"))
    .filter((name) => statSync(path.join(root, "help", name)).isDirectory())
    .map((name) => [
      `help-${name}`,
      path.join(root, "help", name, "index.html"),
    ]),
);

// The site is served from the root of zvid.app. SITE_BASE overrides that
// for a build hosted under a path.
export default defineConfig({
  base: process.env.SITE_BASE ?? "/",
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: {
      input: {
        landing: path.join(root, "index.html"),
        help: path.join(root, "help", "index.html"),
        ...helpPages,
      },
    },
  },
  server: {
    fs: {
      // @zvid/tokens is linked from ../packages/tokens; its fonts are served
      // from there in dev.
      allow: [root, path.resolve(root, "../packages/tokens")],
    },
  },
});
