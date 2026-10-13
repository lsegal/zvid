import {
  type AgentCommandHost,
  type AgentRelayResult,
  runAgentRelayRequest,
} from "./protocol";

// In the desktop app the native process listens for the relay on a local
// port (src-tauri/src/agent_relay.rs) and hands each request to this window
// as an event; the window answers through the agent_relay_respond command.

export const AGENT_RELAY_REQUEST_EVENT = "agent-relay:request";

interface DesktopRelayRequest {
  id: number;
  method: "list" | "call";
  name?: string;
  arguments?: Record<string, unknown>;
}

interface TauriRelayApi {
  listen(
    event: string,
    handler: (event: { payload: DesktopRelayRequest }) => void,
  ): Promise<() => void>;
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Answers the native relay's requests until the returned stop function runs. */
export async function serveDesktopAgentRelay(
  host: AgentCommandHost,
  api: TauriRelayApi,
): Promise<() => void> {
  const unlisten = await api.listen(
    AGENT_RELAY_REQUEST_EVENT,
    ({ payload }) => {
      void runAgentRelayRequest(host, payload).then(
        (response: AgentRelayResult) =>
          api.invoke("agent_relay_respond", { id: payload.id, response }),
      );
    },
  );
  await api.invoke("agent_relay_ready", { ready: true });
  return () => {
    unlisten();
    void api.invoke("agent_relay_ready", { ready: false });
  };
}
