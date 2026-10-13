import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { WebSocket as WsClient } from "ws";
import { runAgentRelayRequest } from "../../src/agent-relay/protocol.ts";
import { connectWebTabAgentRelay } from "../../src/agent-relay/web-tab.ts";
import {
  desktopDiscoveryPath,
  readDesktopDiscovery,
  requestDesktop,
} from "./desktop-link.mjs";
import { createMcpServer, createRelay } from "./mcp-server.mjs";
import { createWebTabHub } from "./web-tabs.mjs";

// Stands in for zvid's control surface: one command that records its calls.
function fakeHost() {
  const calls = [];
  return {
    calls,
    listCommands: () => [
      {
        name: "set_playhead",
        description: "Moves the playhead.",
        inputSchema: {
          type: "object",
          properties: { seconds: { type: "number" } },
        },
      },
    ],
    runCommand: async (name, args) => {
      if (name !== "set_playhead") throw new Error(`Unknown command ${name}`);
      calls.push(args);
      return { playhead: args.seconds };
    },
  };
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("timed out waiting");
}

let nextRpcId = 1;
function rpc(server, method, params) {
  return server.handle({ jsonrpc: "2.0", id: nextRpcId++, method, params });
}

test("relays MCP tool calls to a connected web tab and back", async (t) => {
  let changes = 0;
  const hub = createWebTabHub({ port: 0, onChange: () => changes++ });
  await hub.ready;
  t.after(() => hub.close());
  const host = fakeHost();
  const stop = connectWebTabAgentRelay(
    host,
    `ws://127.0.0.1:${hub.port()}`,
    { version: "1.2.3" },
  );
  t.after(stop);
  await waitFor(() => hub.tabCount() === 1);
  assert.equal(hub.latestTab().version, "1.2.3");
  assert.equal(changes, 1);

  const server = createMcpServer({ relay: createRelay({ webTabs: hub }) });
  const listed = await rpc(server, "tools/list");
  const names = listed.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    "zvid_status",
    "zvid_list_commands",
    "zvid_call",
    "set_playhead",
  ]);

  const direct = await rpc(server, "tools/call", {
    name: "set_playhead",
    arguments: { seconds: 4 },
  });
  assert.equal(direct.result.isError, false);
  assert.deepEqual(JSON.parse(direct.result.content[0].text), {
    playhead: 4,
  });

  const generic = await rpc(server, "tools/call", {
    name: "zvid_call",
    arguments: { name: "set_playhead", arguments: { seconds: 9 } },
  });
  assert.deepEqual(JSON.parse(generic.result.content[0].text), {
    playhead: 9,
  });
  assert.deepEqual(host.calls, [{ seconds: 4 }, { seconds: 9 }]);

  const failed = await rpc(server, "tools/call", {
    name: "explode",
    arguments: {},
  });
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /Unknown command explode/);
});

test("reports no instance, and a tab that closes mid-request", async (t) => {
  const hub = createWebTabHub({ port: 0 });
  await hub.ready;
  t.after(() => hub.close());
  const relay = createRelay({ webTabs: hub });

  const none = await relay.request({ method: "list" });
  assert.equal(none.ok, false);
  assert.match(none.error.message, /No zvid instance is connected/);

  // A tab that never answers, then closes.
  const socket = new WsClient(`ws://127.0.0.1:${hub.port()}`);
  await once(socket, "open");
  socket.send(JSON.stringify({ type: "hello", app: "zvid", version: "x" }));
  await waitFor(() => hub.tabCount() === 1);
  socket.once("message", () => socket.close());
  const closed = await relay.request({ method: "list" });
  assert.equal(closed.ok, false);
  assert.match(closed.error.message, /closed before answering/);
  await waitFor(() => hub.tabCount() === 0);
});

test("refuses web tabs from other origins", async (t) => {
  const hub = createWebTabHub({
    port: 0,
    allowOrigins: ["https://zvid.example"],
  });
  await hub.ready;
  t.after(() => hub.close());
  const url = `ws://127.0.0.1:${hub.port()}`;

  const evil = new WsClient(url, { origin: "https://evil.example" });
  const [error] = await once(evil, "error");
  assert.match(error.message, /401/);

  for (const origin of ["http://localhost:1420", "https://zvid.example"]) {
    const socket = new WsClient(url, { origin });
    await once(socket, "open");
    socket.close();
  }
});

test("finds the desktop app's discovery file per platform", () => {
  assert.equal(
    desktopDiscoveryPath("darwin", {}, "/Users/me"),
    "/Users/me/Library/Application Support/cc.zvid.edit/agent-relay.json",
  );
  assert.equal(
    desktopDiscoveryPath("linux", {}, "/home/me"),
    "/home/me/.local/share/cc.zvid.edit/agent-relay.json",
  );
  assert.equal(
    desktopDiscoveryPath("linux", { XDG_DATA_HOME: "/data" }, "/home/me"),
    "/data/cc.zvid.edit/agent-relay.json",
  );
  assert.equal(
    desktopDiscoveryPath("linux", { ZVID_DESKTOP_RELAY_FILE: "/x.json" }),
    "/x.json",
  );
  assert.match(
    desktopDiscoveryPath("win32", { APPDATA: "C:\\Roaming" }),
    /cc\.zvid\.edit[\\/]agent-relay\.json$/,
  );
});

// Stands in for the desktop app's native listener (agent_relay.rs): checks
// the token and answers each line through the app-side request handler.
async function fakeDesktopApp(t, host, token) {
  const server = createServer((socket) => {
    const lines = createInterface({ input: socket });
    lines.on("line", async (line) => {
      const message = JSON.parse(line);
      const answer =
        message.token === token
          ? await runAgentRelayRequest(host, message.request)
          : { ok: false, error: { message: "bad token" } };
      socket.write(`${JSON.stringify(answer)}\n`);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const dir = await mkdtemp(join(tmpdir(), "zvid-relay-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "agent-relay.json");
  await writeFile(path, JSON.stringify({ port: server.address().port, token }));
  return path;
}

test("relays requests to the desktop app with its recorded token", async (t) => {
  const host = fakeHost();
  const path = await fakeDesktopApp(t, host, "secret");

  const discovery = await readDesktopDiscovery(path);
  assert.equal(discovery.token, "secret");
  const answer = await requestDesktop(discovery, {
    method: "call",
    name: "set_playhead",
    arguments: { seconds: 2 },
  });
  assert.deepEqual(answer, { ok: true, result: { playhead: 2 } });

  const wrong = await requestDesktop(
    { ...discovery, token: "guess" },
    { method: "list" },
  );
  assert.equal(wrong.ok, false);
  assert.equal(await readDesktopDiscovery(join(path, "missing")), null);
});

test("the zvid-mcp command drives the desktop app over stdio", async (t) => {
  const host = fakeHost();
  const path = await fakeDesktopApp(t, host, "secret");
  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, "zvid-mcp.mjs"), "--target", "desktop"],
    {
      env: { ...process.env, ZVID_DESKTOP_RELAY_FILE: path },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  t.after(() => child.kill());
  const responses = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();
  const send = async (message) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    return JSON.parse((await responses.next()).value);
  };

  const init = await send({
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {} },
  });
  assert.equal(init.result.serverInfo.name, "zvid");
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const status = await send({
    id: 2,
    method: "tools/call",
    params: { name: "zvid_status", arguments: {} },
  });
  assert.deepEqual(JSON.parse(status.result.content[0].text), {
    target: "desktop",
    webTabs: 0,
    desktop: true,
  });
  const call = await send({
    id: 3,
    method: "tools/call",
    params: { name: "set_playhead", arguments: { seconds: 6 } },
  });
  assert.deepEqual(JSON.parse(call.result.content[0].text), { playhead: 6 });
  assert.deepEqual(host.calls, [{ seconds: 6 }]);
  const unknown = await send({ id: 4, method: "resources/list" });
  assert.equal(unknown.error.code, -32601);
});
