// The wire protocol between a running zvid and the external-agent relay
// (scripts/agent-relay): the relay asks the app for its control-surface
// commands, or to run one, and the app answers each request by id. The web
// tab speaks it over a WebSocket (web-tab.ts), the desktop app over Tauri
// events relayed through the native process (desktop.ts).

/** One control-surface command, described as an MCP tool. */
export interface AgentCommandDescriptor {
  name: string;
  description: string;
  inputSchema: object;
}

export type AgentRelayResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string; code?: string } };

/** What the relay needs from the app: the control surface's shape. */
export interface AgentCommandHost {
  tools(): AgentCommandDescriptor[];
  call(name: string, input?: unknown): Promise<AgentRelayResult>;
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

const NOT_READY: AgentRelayResult = {
  ok: false,
  error: {
    code: "unavailable",
    message: "zvid is still starting up. Try again in a moment.",
  },
};

/** Runs one relay request against the host, or answers that zvid isn't
 * ready while it has none. Never throws. */
export async function runAgentRelayRequest(
  host: AgentCommandHost | undefined,
  request: Pick<AgentRelayRequest, "method" | "name" | "arguments">,
): Promise<AgentRelayResult> {
  if (!host) return NOT_READY;
  try {
    if (request.method === "list") return { ok: true, result: host.tools() };
    if (!request.name) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          message: "A command name is required.",
        },
      };
    }
    return await host.call(request.name, request.arguments ?? {});
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** Answers one raw relay message, or returns null when it isn't a request. */
export async function respondToAgentRelayMessage(
  host: AgentCommandHost | undefined,
  raw: unknown,
): Promise<AgentRelayResponse | null> {
  const request = parseAgentRelayRequest(raw);
  if (!request) return null;
  const result = await runAgentRelayRequest(host, request);
  return { type: "response", id: request.id, ...result };
}
