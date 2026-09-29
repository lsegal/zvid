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

/** Handles `GET /api/ice-servers`: `{ iceServers: RTCIceServer[] }`. */
export async function handleIceServers(
  request: Request,
  env: TurnEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET" },
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
