// The wire protocol between a running zvid and the external-agent relay
// (scripts/agent-relay): the relay asks the app for its control-surface
// commands, or to run one, and the app answers each request by id. The web
// tab speaks it over a WebSocket (web-tab.ts), the desktop app over Tauri
// events relayed through the native process (desktop.ts).

/** One control-surface command, described for an MCP tool listing. */
export interface AgentCommandDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** What the relay needs from the app's control surface. */
export interface AgentCommandHost {
  listCommands(): AgentCommandDescriptor[] | Promise<AgentCommandDescriptor[]>;
  runCommand(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export type AgentRelayTarget = "web" | "desktop";

export interface AgentRelayHello {
  type: "hello";
  app: "zvid";
  target: AgentRelayTarget;
  version: string;
}

export interface AgentRelayRequest {
  type: "request";
  id: number | string;
  method: "list" | "call";
  name?: string;
  arguments?: Record<string, unknown>;
}

export type AgentRelayResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string } };

export type AgentRelayResponse = AgentRelayResult & {
  type: "response";
  id: number | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAgentRelayRequest(
  value: unknown,
): AgentRelayRequest | null {
  if (!isRecord(value) || value.type !== "request") return null;
  const { id, method, name } = value;
  if (typeof id !== "number" && typeof id !== "string") return null;
  if (method !== "list" && method !== "call") return null;
  if (name !== undefined && typeof name !== "string") return null;
  if (value.arguments !== undefined && !isRecord(value.arguments)) return null;
  return {
    type: "request",
    id,
    method,
    name,
    arguments: value.arguments,
  };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "The command failed.";
}

/** Runs one relay request against the host. Never throws: failures come
 * back as an `ok: false` result the agent can read. */
export async function runAgentRelayRequest(
  host: AgentCommandHost,
  request: Pick<AgentRelayRequest, "method" | "name" | "arguments">,
): Promise<AgentRelayResult> {
  try {
    if (request.method === "list") {
      return { ok: true, result: await host.listCommands() };
    }
    if (!request.name) {
      return { ok: false, error: { message: "A command name is required." } };
    }
    const result = await host.runCommand(
      request.name,
      request.arguments ?? {},
    );
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) } };
  }
}

/** Answers one raw relay message, or returns null when it isn't a request. */
export async function respondToAgentRelayMessage(
  host: AgentCommandHost,
  raw: unknown,
): Promise<AgentRelayResponse | null> {
  const request = parseAgentRelayRequest(raw);
  if (!request) return null;
  const result = await runAgentRelayRequest(host, request);
  return { type: "response", id: request.id, ...result };
}
