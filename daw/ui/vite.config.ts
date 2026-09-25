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
});
