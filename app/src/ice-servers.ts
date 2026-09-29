// Runtime TURN relay for collaboration. The app worker mints short-lived
// TURN credentials at /api/ice-servers (worker/turn.ts); they are merged with
// the configured ICE servers before each session, falling back to those
// alone when the relay can't be fetched.

import { isIceServer } from "./collaboration-diagnostics.ts";

export const RELAY_ICE_SERVERS_PATH = "/api/ice-servers";

// The deployed app's relay endpoint, which the native app uses by default
// since it has no Worker of its own. The Worker allows the native app's
// origins through CORS.
export const NATIVE_RELAY_ICE_SERVERS_URL =
  "https://zvid.lsegal.workers.dev/api/ice-servers";

// A session waits at most this long for relay credentials before starting
// with the configured servers alone.
export const RELAY_FETCH_TIMEOUT_MS = 5000;

type Log = (event: string, payload?: unknown) => void;

/**
 * Where to fetch relay credentials: `VITE_ICE_SERVERS_URL` when set ("none"
 * disables the relay), otherwise the app worker on the page's own origin.
 * The native app has no worker of its own, so it uses the deployed app's.
 */
export function resolveRelayIceServersUrl(
  configured: string | undefined,
  origin: string | undefined,
  native: boolean,
): string | null {
  const value = configured?.trim();
  if (value) {
    return value.toLowerCase() === "none" ? null : value;
  }
  if (native) {
    return NATIVE_RELAY_ICE_SERVERS_URL;
  }
  if (!origin || !/^https?:/i.test(origin)) {
    return null;
  }
  return new URL(RELAY_ICE_SERVERS_PATH, origin).toString();
}

/** Adds the relay's servers after the configured ones, skipping duplicates. */
export function mergeIceServers(
  configured: RTCIceServer[],
  relay: RTCIceServer[],
): RTCIceServer[] {
  const seen = new Set(configured.map((server) => JSON.stringify(server)));
  const merged = [...configured];
  for (const server of relay) {
    const key = JSON.stringify(server);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(server);
    }
  }
  return merged;
}

/** Validates the worker's `{ iceServers: RTCIceServer[] }` response. */
export function parseRelayIceServers(body: unknown): RTCIceServer[] {
  const servers = (body as { iceServers?: unknown } | null)?.iceServers;
  if (
    !Array.isArray(servers) ||
    servers.length === 0 ||
    !servers.every(isIceServer)
  ) {
    throw new Error("Relay response has no ICE servers.");
  }
  return servers;
}

/**
 * The ICE servers for a collaboration session: the configured servers plus
 * the relay's short-lived TURN servers, or the configured servers alone when
 * there is no relay URL or the fetch fails.
 */
export async function loadIceServers(
  configured: RTCIceServer[],
  url: string | null,
  options: {
    fetch?: typeof fetch;
    log?: Log;
    timeoutMs?: number;
  } = {},
): Promise<RTCIceServer[]> {
  const log = options.log ?? (() => {});
  if (!url) {
    return configured;
  }

  const fetcher = options.fetch ?? fetch;
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? RELAY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Relay responded ${response.status}.`);
    }
    const relay = parseRelayIceServers(await response.json());
    log("collaboration:ice:relay", {
      url,
      iceServers: relay.map((server) => server.urls),
    });
    return mergeIceServers(configured, relay);
  } catch (error) {
    log("collaboration:ice:relay:error", {
      url,
      error: error instanceof Error ? error.message : String(error),
      fallback: "configured ICE servers only",
    });
    return configured;
  }
}
