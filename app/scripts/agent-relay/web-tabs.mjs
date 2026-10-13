// Accepts zvid web tabs opened with `?agent-relay` (src/agent-relay/web-tab.ts)
// on a loopback WebSocket and relays requests to the most recently connected
// one. A browser can't listen for connections, so the tab dials in.
import { WebSocketServer } from "ws";

export const DEFAULT_WEB_TAB_PORT = 47311;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// Pages that may connect: the app's own origins, local dev servers, and the
// desktop webview. Anything else would be a page impersonating zvid.
const DEFAULT_ALLOWED_ORIGINS = [
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
  /^https:\/\/zvid\.lsegal\.workers\.dev$/,
  /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)$/,
];

export function isAllowedOrigin(origin, extraOrigins = []) {
  if (!origin) return true;
  return (
    extraOrigins.includes(origin) ||
    DEFAULT_ALLOWED_ORIGINS.some((pattern) => pattern.test(origin))
  );
}

/**
 * @param {{ port?: number, host?: string, allowOrigins?: string[],
 *   timeoutMs?: number, onChange?: () => void }} options
 */
export function createWebTabHub(options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tabs = [];
  const pending = new Map();
  let nextId = 1;

  const server = new WebSocketServer({
    host: options.host ?? "127.0.0.1",
    port: options.port ?? DEFAULT_WEB_TAB_PORT,
    verifyClient: ({ origin }) => isAllowedOrigin(origin, options.allowOrigins),
  });

  server.on("connection", (socket) => {
    const tab = { socket, version: null };
    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message?.type === "hello" && message.app === "zvid") {
        tab.version = String(message.version ?? "");
        tabs.push(tab);
        options.onChange?.();
        return;
      }
      if (message?.type === "response" && pending.has(message.id)) {
        const { resolve, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        resolve(
          message.ok
            ? { ok: true, result: message.result }
            : { ok: false, error: message.error },
        );
      }
    });
    socket.on("close", () => {
      const index = tabs.indexOf(tab);
      if (index < 0) return;
      tabs.splice(index, 1);
      for (const [id, entry] of pending) {
        if (entry.socket !== socket) continue;
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve({
          ok: false,
          error: { message: "The zvid tab closed before answering." },
        });
      }
      options.onChange?.();
    });
  });

  return {
    ready: new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    }),
    port: () => server.address()?.port,
    tabCount: () => tabs.length,
    latestTab: () => tabs.at(-1) ?? null,
    /** Sends `{ method, name, arguments }` to the newest tab. */
    request(request) {
      const tab = tabs.at(-1);
      if (!tab) {
        return Promise.resolve({
          ok: false,
          error: { message: "No zvid web tab is connected." },
        });
      }
      const id = nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({
            ok: false,
            error: { message: "The zvid tab did not answer in time." },
          });
        }, timeoutMs);
        pending.set(id, { resolve, timer, socket: tab.socket });
        tab.socket.send(JSON.stringify({ type: "request", id, ...request }));
      });
    },
    close() {
      for (const tab of tabs) tab.socket.terminate();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
