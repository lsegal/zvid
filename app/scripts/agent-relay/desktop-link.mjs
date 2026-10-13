// Reaches a running zvid desktop app. The app listens on a loopback port and
// records the port and a per-launch token in agent-relay.json in its app
// data folder (src-tauri/src/agent_relay.rs); each request is one JSON line
// with the token, answered by one JSON line.
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

// tauri.conf.json's identifier, which names the app data folder.
const APP_IDENTIFIER = "cc.zvid.edit";
export const DISCOVERY_FILE = "agent-relay.json";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** Where the desktop app records its relay port, per Tauri's app data dir. */
export function desktopDiscoveryPath(
  platform = process.platform,
  env = process.env,
  home = homedir(),
) {
  if (env.ZVID_DESKTOP_RELAY_FILE) return env.ZVID_DESKTOP_RELAY_FILE;
  if (platform === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      APP_IDENTIFIER,
      DISCOVERY_FILE,
    );
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, APP_IDENTIFIER, DISCOVERY_FILE);
  }
  const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(dataHome, APP_IDENTIFIER, DISCOVERY_FILE);
}

function isRunning(pid) {
  if (!Number.isInteger(pid)) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === "EPERM";
  }
}

/** The recorded `{ port, token }`, or null when the app isn't running. A
 * killed app leaves its file behind, so the recorded process must be alive. */
export async function readDesktopDiscovery(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  try {
    const { port, token, pid } = JSON.parse(text);
    if (Number.isInteger(port) && typeof token === "string" && isRunning(pid)) {
      return { port, token };
    }
  } catch {}
  return null;
}

/** Sends one `{ method, name, arguments }` request to the desktop app and
 * resolves with its `{ ok, result | error }` answer. */
export function requestDesktop(
  discovery,
  request,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: discovery.port });
    let buffer = "";
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () =>
      fail(new Error("The zvid desktop app did not answer in time.")),
    );
    socket.on("error", (error) =>
      fail(
        new Error(
          error.code === "ECONNREFUSED"
            ? "The zvid desktop app is not running."
            : `Could not reach the zvid desktop app: ${error.message}`,
        ),
      ),
    );
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ token: discovery.token, request })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch {
        reject(new Error("The zvid desktop app sent an unreadable answer."));
      }
    });
  });
}
