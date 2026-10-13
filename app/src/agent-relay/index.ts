import { ZVID_VERSION } from "../version";
import { serveDesktopAgentRelay } from "./desktop.ts";
import type { AgentCommandHost } from "./protocol.ts";
import { connectWebTabAgentRelay, resolveAgentRelayUrl } from "./web-tab.ts";

// The running app's control surface, which the app installs as `window.zvid`
// once the editor mounts. Read per request, so requests that arrive first
// get a "still starting up" answer.
function controlSurface(): AgentCommandHost | undefined {
  return (window as { zvid?: AgentCommandHost }).zvid;
}

/** Lets an external agent drive this zvid: always in the desktop app, and
 * in a web tab opened with `?agent-relay`. */
export async function startAgentRelay() {
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    await serveDesktopAgentRelay(controlSurface, { listen, invoke });
    return;
  }
  const url = resolveAgentRelayUrl(location.search, sessionStorage);
  if (!url) return;
  connectWebTabAgentRelay(controlSurface, url, {
    version: ZVID_VERSION,
    onStatus: (connected) =>
      console.info(
        `zvid: agent relay ${connected ? "connected to" : "waiting for"} ${url}`,
      ),
  });
}
