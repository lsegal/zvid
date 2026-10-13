import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { expect, test } from "@playwright/test";

// An external agent drives a zvid web tab: the zvid MCP server
// (scripts/agent-relay/zvid-mcp.mjs) relays MCP tool calls to a tab opened
// with ?agent-relay, which runs them on its control surface.

type RpcMessage = {
  id?: number;
  method?: string;
  result?: {
    tools?: Array<{ name: string }>;
    content?: Array<{ text: string }>;
    isError?: boolean;
  };
};

// Talks MCP to the server over its stdio.
function mcpClient(child: ChildProcess) {
  const messages: RpcMessage[] = [];
  const waiters: Array<() => void> = [];
  if (!child.stdout) throw new Error("The server has no stdout.");
  createInterface({ input: child.stdout }).on("line", (line) => {
    messages.push(JSON.parse(line));
    for (const wake of waiters.splice(0)) wake();
  });
  async function next(match: (message: RpcMessage) => boolean) {
    for (;;) {
      const index = messages.findIndex(match);
      if (index >= 0) return messages.splice(index, 1)[0];
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  }
  let nextId = 1;
  return {
    next,
    async request(method: string, params: object = {}) {
      const id = nextId++;
      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      return next((message) => message.id === id);
    },
  };
}

// Starts the server on a free port and resolves with the port it chose.
async function startServer() {
  const child = spawn(
    process.execPath,
    [
      path.join(import.meta.dirname, "../scripts/agent-relay/zvid-mcp.mjs"),
      "--target",
      "web",
      "--port",
      "0",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  if (!child.stderr) throw new Error("The server has no stderr.");
  const port = await new Promise<number>((resolve, reject) => {
    child.once("exit", () => reject(new Error("The server exited.")));
    createInterface({ input: child.stderr as NodeJS.ReadableStream }).on(
      "line",
      (line) => {
        const match = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(line);
        if (match) resolve(Number(match[1]));
      },
    );
  });
  return { child, port };
}

test("an MCP client drives a zvid web tab through the relay", async ({
  page,
}) => {
  const { child, port } = await startServer();
  try {
    const mcp = mcpClient(child);
    await mcp.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1" },
    });

    await page.goto(`/?agent-relay=${port}`);
    await expect(page.locator("[data-layer-header-id]")).toHaveCount(1);
    await mcp.next(
      (message) => message.method === "notifications/tools/list_changed",
    );

    const listed = await mcp.request("tools/list");
    const names = listed.result?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(["zvid_status", "add_layer", "get_session"]),
    );

    const added = await mcp.request("tools/call", {
      name: "add_layer",
      arguments: { name: "Agent layer" },
    });
    expect(added.result?.isError).toBe(false);
    await expect(page.locator("[data-layer-header-id]")).toHaveCount(2);
    await expect(page.getByText("Agent layer")).toBeVisible();

    const session = await mcp.request("tools/call", {
      name: "zvid_call",
      arguments: { name: "get_session" },
    });
    expect(session.result?.content?.[0].text).toContain("Agent layer");

    const invalid = await mcp.request("tools/call", {
      name: "add_layer",
      arguments: { name: 3 },
    });
    expect(invalid.result?.isError).toBe(true);
    expect(invalid.result?.content?.[0].text).toContain("invalid_input");
  } finally {
    child.kill();
  }
});
