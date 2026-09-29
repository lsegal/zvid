// Mints short-lived TURN credentials with Cloudflare Realtime TURN, so the
// long-lived API token stays a Worker secret instead of shipping in the app.
// See README.md (Collaboration TURN relay).

export type TurnEnv = {
  // Cloudflare Realtime TURN key ID and its API token, set with
  // `wrangler secret put`. Without both, no relay is offered.
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
};

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

// How long minted credentials stay valid. A relayed session needs them to
// refresh its allocation, so this outlasts a long editing session.
export const TURN_CREDENTIAL_TTL_SECONDS = 24 * 60 * 60;

const TURN_API_BASE = "https://rtc.live.cloudflare.com/v1/turn/keys";

const NO_STORE = { "Cache-Control": "no-store" };

// The native (Tauri) app has no Worker of its own, so it fetches relay
// credentials from the deployed app's endpoint cross-origin: tauri://localhost
// on macOS and Linux, http://tauri.localhost on Windows. Only these origins
// are allowed; the web app itself calls the endpoint same-origin.
export const NATIVE_APP_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
];

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !NATIVE_APP_ORIGINS.includes(origin)) {
    return { Vary: "Origin" };
  }
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function withHeaders(response: Response, headers: Record<string, string>) {
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  return response;
}

function isIceServer(value: unknown): value is IceServer {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { urls } = value as Record<string, unknown>;
  return (
    typeof urls === "string" ||
    (Array.isArray(urls) && urls.every((url) => typeof url === "string"))
  );
}

// Browsers block port 53, so Cloudflare recommends dropping those URLs to
// avoid ICE gathering timeouts.
function withoutPort53(server: IceServer): IceServer | null {
  const urls = (
    Array.isArray(server.urls) ? server.urls : [server.urls]
  ).filter((url) => !/:53(\?|$)/.test(url));
  return urls.length > 0 ? { ...server, urls } : null;
}

/**
 * Handles `GET /api/ice-servers`: `{ iceServers: RTCIceServer[] }`, plus the
 * CORS preflight for the native app's origins.
 */
export async function handleIceServers(
  request: Request,
  env: TurnEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") {
    const preflight: Record<string, string> = {
      ...cors,
      Allow: "GET, OPTIONS",
    };
    if (cors["Access-Control-Allow-Origin"]) {
      preflight["Access-Control-Allow-Methods"] = "GET";
      preflight["Access-Control-Allow-Headers"] = "Accept";
      preflight["Access-Control-Max-Age"] = "86400";
    }
    return new Response(null, { status: 204, headers: preflight });
  }
  return withHeaders(await mintIceServers(request, env, fetcher), cors);
}

async function mintIceServers(
  request: Request,
  env: TurnEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, OPTIONS" },
    });
  }

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return Response.json(
      { error: "TURN relay is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const response = await fetcher(
      `${TURN_API_BASE}/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
      },
    );
    if (!response.ok) {
      throw new Error(`Cloudflare TURN responded ${response.status}`);
    }

    const body = (await response.json()) as { iceServers?: unknown };
    const servers = Array.isArray(body.iceServers)
      ? body.iceServers
      : [body.iceServers];
    if (!servers.every(isIceServer)) {
      throw new Error("Cloudflare TURN returned no ICE servers");
    }

    return Response.json(
      {
        iceServers: servers
          .map(withoutPort53)
          .filter((server) => server !== null),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error(
      `TURN credentials failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return Response.json(
      { error: "Could not obtain TURN credentials" },
      { status: 502, headers: NO_STORE },
    );
  }
}
