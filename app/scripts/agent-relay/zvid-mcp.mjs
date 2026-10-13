#!/usr/bin/env node
// The zvid MCP server: lets an external agent (Claude Code, Codex or any MCP
// client) drive a running zvid web tab or desktop app. Register it with the
// agent as a stdio server; see README.md beside this file.
//
// Usage: node app/scripts/agent-relay/zvid-mcp.mjs [options]
//   --target <auto|web|desktop>  which zvid to drive (default auto: a
//                                connected web tab, else the desktop app)
//   --port <n>                   loopback port web tabs connect to
//                                (default 47311)
//   --allow-origin <origin>      also accept web tabs from this origin
//                                (repeatable)
import { parseArgs } from "node:util";
import {
  desktopDiscoveryPath,
  readDesktopDiscovery,
  requestDesktop,
} from "./desktop-link.mjs";
import {
  createMcpServer,
  createRelay,
  serveStdio,
  TOOLS_CHANGED,
} from "./mcp-server.mjs";
import { createWebTabHub, DEFAULT_WEB_TAB_PORT } from "./web-tabs.mjs";

const { values } = parseArgs({
  options: {
    target: { type: "string", default: "auto" },
    port: { type: "string", default: String(DEFAULT_WEB_TAB_PORT) },
    "allow-origin": { type: "string", multiple: true, default: [] },
  },
});
const target = values.target;
if (!["auto", "web", "desktop"].includes(target)) {
  console.error(`zvid-mcp: unknown --target ${target}`);
  process.exit(2);
}

// stdout carries the protocol, so diagnostics go to stderr.
const log = (message) => console.error(`zvid-mcp: ${message}`);

let notify = () => {};
let webTabs;
if (target !== "desktop") {
  webTabs = createWebTabHub({
    port: Number(values.port),
    allowOrigins: values["allow-origin"],
    onChange: () => {
      log(`${webTabs.tabCount()} zvid web tab(s) connected`);
      notify(TOOLS_CHANGED);
    },
  });
  try {
    await webTabs.ready;
    log(`waiting for zvid web tabs on ws://127.0.0.1:${webTabs.port()}`);
  } catch (error) {
    log(`could not listen for web tabs: ${error.message}`);
    webTabs = undefined;
  }
}

const discoveryPath = desktopDiscoveryPath();
const desktop =
  target === "web"
    ? undefined
    : {
        available: async () =>
          (await readDesktopDiscovery(discoveryPath)) !== null,
        request: async (request) => {
          const discovery = await readDesktopDiscovery(discoveryPath);
          if (!discovery)
            throw new Error("The zvid desktop app is not running.");
          return requestDesktop(discovery, request);
        },
      };

const server = createMcpServer({
  relay: createRelay({ webTabs, desktop, target }),
});
({ notify } = serveStdio(server, process.stdin, process.stdout));
process.stdin.on("end", () => {
  void webTabs?.close();
  process.exit(0);
});
