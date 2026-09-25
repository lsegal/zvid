import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The build is embedded in the plugin and served from zvid://app/, so asset
// URLs are relative and fonts stay separate files rather than inlined.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    target: "es2022",
  },
  server: {
    fs: {
      // @zvid/tokens is linked from ../../packages/tokens; its fonts are
      // served from there in dev.
      allow: [
        import.meta.dirname,
        path.resolve(import.meta.dirname, "../../packages/tokens"),
      ],
    },
  },
});
