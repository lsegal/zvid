import {
  type AgentCommandHost,
  type AgentRelayHello,
  respondToAgentRelayMessage,
} from "./protocol";

// A zvid page opened with `?agent-relay` (or `?agent-relay=<port or ws URL>`)
// connects to the external-agent relay (scripts/agent-relay) and runs the
// commands it relays. The setting lasts for the tab's session, so reloading
// the page keeps it connected.

export const AGENT_RELAY_PARAM = "agent-relay";
export const DEFAULT_AGENT_RELAY_PORT = 47311;
const STORAGE_KEY = "zvid.agentRelayUrl";
const RECONNECT_DELAY_MS = 2_000;

/** The relay URL a page URL asks for, or null when it doesn't opt in. */
export function agentRelayUrlFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has(AGENT_RELAY_PARAM)) return null;
  const value = params.get(AGENT_RELAY_PARAM)?.trim() ?? "";
  if (value === "") return `ws://127.0.0.1:${DEFAULT_AGENT_RELAY_PORT}`;
  if (/^\d+$/.test(value)) return `ws://127.0.0.1:${value}`;
  if (/^wss?:\/\//.test(value)) return value;
  return null;
}

export function resolveAgentRelayUrl(
  search: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): string | null {
  const fromSearch = agentRelayUrlFromSearch(search);
  if (fromSearch) {
    storage?.setItem(STORAGE_KEY, fromSearch);
    return fromSearch;
  }
  return storage?.getItem(STORAGE_KEY) ?? null;
}

type SocketFactory = (url: string) => WebSocket;

export interface WebTabRelayOptions {
  version: string;
  createSocket?: SocketFactory;
  reconnectDelayMs?: number;
  onStatus?: (connected: boolean) => void;
}

/** Keeps the tab connected to the relay, reconnecting while the relay is
 * down, until the returned stop function runs. */
export function connectWebTabAgentRelay(
  host: AgentCommandHost,
  url: string,
  options: WebTabRelayOptions,
): () => void {
  const createSocket = options.createSocket ?? ((target) => new WebSocket(target));
  const reconnectDelayMs = options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (stopped) return;
    const current = createSocket(url);
    socket = current;
    current.addEventListener("open", () => {
      const hello: AgentRelayHello = {
        type: "hello",
        app: "zvid",
        target: "web",
        version: options.version,
      };
      current.send(JSON.stringify(hello));
      options.onStatus?.(true);
    });
    current.addEventListener("message", (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      void respondToAgentRelayMessage(host, raw).then((response) => {
        if (response && current.readyState === current.OPEN) {
          current.send(JSON.stringify(response));
        }
      });
    });
    current.addEventListener("close", () => {
      options.onStatus?.(false);
      if (socket === current) socket = null;
      if (!stopped) retry = setTimeout(connect, reconnectDelayMs);
    });
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}
