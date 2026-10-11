import { mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default mergeConfig(base, {
  test: { browser: { api: { port: Number(process.env.VPORT), strictPort: true } } },
});
