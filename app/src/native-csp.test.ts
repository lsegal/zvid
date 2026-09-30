import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NATIVE_RELAY_ICE_SERVERS_URL } from "./ice-servers.ts";
import {
  PUBLIC_SIGNALING_URL,
  ZVID_SIGNALING_URL,
} from "./signaling-servers.ts";
import { googleFontsCssUrl } from "./text-fonts.ts";

// The native webview enforces app.security.csp, whose connect-src also
// governs WebSockets. The collaboration defaults must stay reachable, so
// check them against it here rather than in a running native build.
const csp = (
  JSON.parse(
    readFileSync(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
    ).toString("utf8"),
  ) as { app: { security: { csp: Record<string, string | string[]> } } }
).app.security.csp;

function directiveSources(name: string) {
  const value = csp[name] ?? csp["default-src"];
  return (Array.isArray(value) ? value : [value]).flatMap((entry) =>
    entry.split(/\s+/),
  );
}

const connectSources = directiveSources("connect-src");

// Scheme sources ("wss:") and host sources ("https://host[:port][/path]"),
// the forms the CSP uses; wildcards and keywords aren't needed.
function sourceAllows(source: string, target: URL) {
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
    return target.protocol === source.toLowerCase();
  }
  let allowed: URL;
  try {
    allowed = new URL(source);
  } catch {
    return false;
  }
  if (allowed.origin !== target.origin) {
    return false;
  }
  const path = allowed.pathname;
  if (path === "/") {
    return true;
  }
  return path.endsWith("/")
    ? target.pathname.startsWith(path)
    : target.pathname === path;
}

function connectSrcAllows(url: string) {
  const target = new URL(url);
  return connectSources.some((source) => sourceAllows(source, target));
}

describe("native app CSP connect-src", () => {
  it("allows the default signaling servers", () => {
    for (const url of [ZVID_SIGNALING_URL, PUBLIC_SIGNALING_URL]) {
      assert.ok(connectSrcAllows(url), url);
    }
  });

  it("allows the default native relay", () => {
    assert.ok(
      connectSrcAllows(NATIVE_RELAY_ICE_SERVERS_URL),
      NATIVE_RELAY_ICE_SERVERS_URL,
    );
  });

  it("allows signaling servers an invite or build names", () => {
    for (const url of [
      "wss://signaling.example/room",
      "ws://192.168.1.20:4444",
      "ws://localhost:8787",
    ]) {
      assert.ok(connectSrcAllows(url), url);
    }
  });

  it("allows the app's own origin, which serves the sample media", () => {
    assert.ok(connectSources.includes("'self'"));
  });

  it("still blocks arbitrary HTTP origins", () => {
    assert.equal(connectSrcAllows("https://example.com/"), false);
  });
});

describe("native app CSP fonts", () => {
  const allows = (directive: string, url: string) =>
    directiveSources(directive).some((source) =>
      sourceAllows(source, new URL(url)),
    );

  it("allows Google Fonts stylesheets and font files for Text clips", () => {
    assert.ok(allows("style-src", googleFontsCssUrl(["Roboto"])));
    assert.ok(
      allows("font-src", "https://fonts.gstatic.com/s/roboto/v1/roboto.woff2"),
    );
  });

  it("still loads the bundled fonts", () => {
    assert.ok(directiveSources("font-src").includes("'self'"));
  });
});
