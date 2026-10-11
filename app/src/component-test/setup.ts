// The stylesheets main.tsx and App.tsx load for the whole app. Component
// tests render without App, so this file loads them before every test;
// a change to any of them selects the whole component suite.
import "../index.css";
import "../text-fonts.css";
import "../App.css";
import "../coarse-pointer.css";
import { afterEach } from "vitest";
import { resetViewport } from "./viewport.ts";

afterEach(async () => {
  await resetViewport();
});
