import assert from "node:assert/strict";
import { test } from "node:test";
import { serveDesktopAgentRelay } from "./desktop.ts";
import {
  type AgentCommandHost,
  respondToAgentRelayMessage,
} from "./protocol.ts";
import { agentRelayUrlFromSearch, resolveAgentRelayUrl } from "./web-tab.ts";

const host: AgentCommandHost = {
  tools: () => [
    { name: "play", description: "Plays.", inputSchema: { type: "object" } },
  ],
  call: async (name, input) => ({ ok: true, result: { name, input } }),
};

test("answers list and call requests by id", async () => {
  assert.deepEqual(
    await respondToAgentRelayMessage(host, {
      type: "request",
      id: 7,
      method: "list",
    }),
    { type: "response", id: 7, ok: true, result: host.tools() },
  );
  assert.deepEqual(
    await respondToAgentRelayMessage(host, {
      type: "request",
      id: "a",
      method: "call",
      name: "play",
      arguments: { at: 1 },
    }),
    {
      type: "response",
      id: "a",
      ok: true,
      result: { name: "play", input: { at: 1 } },
    },
  );
});

test("ignores non-requests and reports a missing surface or name", async () => {
  assert.equal(await respondToAgentRelayMessage(host, { type: "hello" }), null);
  assert.equal(
    await respondToAgentRelayMessage(host, {
      type: "request",
      id: 1,
      method: "drop_tables",
    }),
    null,
  );
  const unready = await respondToAgentRelayMessage(undefined, {
    type: "request",
    id: 2,
    method: "list",
  });
  assert.equal(unready?.ok, false);
  assert.match(JSON.stringify(unready), /starting up/);
  const nameless = await respondToAgentRelayMessage(host, {
    type: "request",
    id: 3,
    method: "call",
  });
  assert.equal(nameless?.ok, false);
});

test("turns a throwing surface into a failed result", async () => {
  const broken: AgentCommandHost = {
    tools: () => {
      throw new Error("boom");
    },
    call: async () => ({ ok: true, result: null }),
  };
  assert.deepEqual(
    await respondToAgentRelayMessage(broken, {
      type: "request",
      id: 1,
      method: "list",
    }),
    {
      type: "response",
      id: 1,
      ok: false,
      error: { code: "failed", message: "boom" },
    },
  );
});

test("reads the relay URL from ?agent-relay and remembers it", () => {
  assert.equal(agentRelayUrlFromSearch(""), null);
  assert.equal(agentRelayUrlFromSearch("?agent-relay"), "ws://127.0.0.1:47311");
  assert.equal(
    agentRelayUrlFromSearch("?sample=1&agent-relay=5000"),
    "ws://127.0.0.1:5000",
  );
  assert.equal(
    agentRelayUrlFromSearch("?agent-relay=ws://host:1/x"),
    "ws://host:1/x",
  );
  assert.equal(agentRelayUrlFromSearch("?agent-relay=javascript:1"), null);

  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  };
  assert.equal(resolveAgentRelayUrl("", storage), null);
  assert.equal(
    resolveAgentRelayUrl("?agent-relay=6000", storage),
    "ws://127.0.0.1:6000",
  );
  assert.equal(resolveAgentRelayUrl("", storage), "ws://127.0.0.1:6000");
});

test("answers the desktop app's relayed requests through its command", async () => {
  type Handler = (event: {
    payload: { id: number; method: "list" | "call"; name?: string };
  }) => void;
  let handler: Handler | undefined;
  const invoked: Array<[string, Record<string, unknown>]> = [];
  const stop = await serveDesktopAgentRelay(() => host, {
    listen: async (_event, next) => {
      handler = next as Handler;
      return () => {
        handler = undefined;
      };
    },
    invoke: async (command, args) => {
      invoked.push([command, args]);
    },
  });
  assert.deepEqual(invoked, [["agent_relay_ready", { ready: true }]]);

  handler?.({ payload: { id: 4, method: "call", name: "play" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(invoked[1], [
    "agent_relay_respond",
    { id: 4, response: { ok: true, result: { name: "play", input: {} } } },
  ]);

  stop();
  assert.equal(handler, undefined);
  assert.deepEqual(invoked.at(-1), ["agent_relay_ready", { ready: false }]);
});
