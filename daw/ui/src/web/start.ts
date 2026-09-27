// Starts the web driver for a page opened outside the plugin and harness,
// configured from the page's query string:
//
// - `platform=windows` renders as on Windows (default `macos`).
// - `takes=none` starts without the demo takes.
// - `manual-transport` stops the simulated transport.
// - `live` simulates the Live companion script.
// - `frames=off` publishes no preview frames on a timer.

import type { Client } from "../ipc/client.ts";
import { DEMO_CLIP, demoTakes, WebDriver } from "./driver.ts";
import { MockBackend } from "./mock-backend.ts";

declare global {
  interface Window {
    /** The running web driver, for tests and the devtools console. */
    __ZVID_DRIVER__?: WebDriver;
  }
}

export function startWebDriver(search: string): Client {
  const params = new URLSearchParams(search);
  const driver = new WebDriver({
    backend: new MockBackend({
      takes: params.get("takes") === "none" ? [] : demoTakes(),
      clip: DEMO_CLIP,
    }),
    platform: params.get("platform") ?? "macos",
  });
  if (params.get("frames") !== "off") {
    driver.simulate({
      autoTransport: !params.has("manual-transport"),
      live: params.has("live"),
    });
  }
  window.__ZVID_DRIVER__ = driver;
  return driver.client();
}
