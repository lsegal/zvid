// A Model Context Protocol server (stdio transport, JSON-RPC 2.0 one message
// per line) that publishes a running zvid's control-surface commands as MCP
// tools and relays each call to it. The zvid it drives is a connected web
// tab when there is one, else the desktop app; `target` pins one of them.

export const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

// Tools the relay itself provides, available before any zvid connects. A
// client that never refreshes its tool list can still reach every command
// through zvid_call.
const RELAY_TOOLS = [
  {
    name: "zvid_status",
    description:
      "Reports which running zvid instances (web tab or desktop app) the relay can reach.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zvid_list_commands",
    description:
      "Lists the control-surface commands of the connected zvid, with their input schemas.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zvid_call",
    description:
      "Runs one control-surface command in the connected zvid by name. Use zvid_list_commands to see the commands and their arguments.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The command name." },
        arguments: {
          type: "object",
          description: "The command's arguments.",
        },
      },
      required: ["name"],
    },
  },
];
const RELAY_TOOL_NAMES = new Set(RELAY_TOOLS.map((tool) => tool.name));

/**
 * Routes requests to a web tab hub (web-tabs.mjs) or the desktop app
 * (desktop-link.mjs).
 * @param {{ webTabs?: { tabCount(): number, request(r: object): Promise<object> },
 *   desktop?: { available(): Promise<boolean>, request(r: object): Promise<object> },
 *   target?: "web" | "desktop" | "auto" }} options
 */
export function createRelay({ webTabs, desktop, target = "auto" }) {
  async function pick() {
    const webReady = Boolean(webTabs && webTabs.tabCount() > 0);
    if (target !== "desktop" && webReady) return webTabs;
    if (target !== "web" && desktop && (await desktop.available())) {
      return desktop;
    }
    return null;
  }

  return {
    async status() {
      return {
        target,
        webTabs: webTabs?.tabCount() ?? 0,
        desktop: desktop ? await desktop.available() : false,
      };
    },
    async request(request) {
      const instance = await pick();
      if (!instance) {
        return {
          ok: false,
          error: {
            message:
              target === "desktop"
                ? "The zvid desktop app is not running."
                : "No zvid instance is connected. Open zvid with ?agent-relay in the address, or start the desktop app.",
          },
        };
      }
      try {
        return await instance.request(request);
      } catch (error) {
        return { ok: false, error: { message: error.message } };
      }
    },
  };
}

function textResult(value, isError = false) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError };
}

function relayResult(answer) {
  if (answer.ok) return textResult(answer.result ?? null);
  return textResult(answer.error?.message ?? "The command failed.", true);
}

/** Handles MCP JSON-RPC messages; `handle` resolves with the response, or
 * null for a notification. */
export function createMcpServer({ relay, version = "0.0.0" }) {
  async function appCommands() {
    const answer = await relay.request({ method: "list" });
    return answer.ok && Array.isArray(answer.result) ? answer.result : [];
  }

  async function callTool(name, args = {}) {
    if (name === "zvid_status") return textResult(await relay.status());
    if (name === "zvid_list_commands") {
      return relayResult(await relay.request({ method: "list" }));
    }
    if (name === "zvid_call") {
      if (typeof args.name !== "string") {
        return textResult("zvid_call needs a command name.", true);
      }
      return relayResult(
        await relay.request({
          method: "call",
          name: args.name,
          arguments: args.arguments ?? {},
        }),
      );
    }
    return relayResult(
      await relay.request({ method: "call", name, arguments: args }),
    );
  }

  async function dispatch(method, params = {}) {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(
            params.protocolVersion,
          )
            ? params.protocolVersion
            : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "zvid", version },
          instructions:
            "Drives a running zvid video editor. Call zvid_status to see what is connected, then use zvid's own command tools (or zvid_list_commands and zvid_call).",
        };
      case "ping":
        return {};
      case "tools/list": {
        const commands = (await appCommands()).filter(
          (command) => !RELAY_TOOL_NAMES.has(command.name),
        );
        return { tools: [...RELAY_TOOLS, ...commands] };
      }
      case "tools/call":
        return callTool(params.name, params.arguments);
      default: {
        const error = new Error(`Method not found: ${method}`);
        error.code = -32601;
        throw error;
      }
    }
  }

  return {
    async handle(message) {
      if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") {
        if (message?.id === undefined) return null;
        return {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32600, message: "Invalid request" },
        };
      }
      // Notifications (no id), such as notifications/initialized, need no
      // answer.
      if (message.id === undefined) return null;
      try {
        const result = await dispatch(message.method, message.params);
        return { jsonrpc: "2.0", id: message.id, result };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: error.code ?? -32603, message: error.message },
        };
      }
    },
  };
}

export const TOOLS_CHANGED = {
  jsonrpc: "2.0",
  method: "notifications/tools/list_changed",
};

/** Serves `server` over newline-delimited JSON on the given streams. */
export function serveStdio(server, input, output) {
  let buffer = "";
  const write = (message) => output.write(`${JSON.stringify(message)}\n`);
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        write({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        continue;
      }
      void server.handle(message).then((response) => {
        if (response) write(response);
      });
    }
  });
  return { notify: write };
}
