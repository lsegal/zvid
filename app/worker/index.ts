import { handleIceServers, type TurnEnv } from "./turn.ts";

type Env = TurnEnv & {
  ASSETS: Fetcher;
};

type VersionInfo = {
  commit?: string;
  buildTime?: string;
};

// The Vite build publishes /version.json alongside the app assets.
async function readVersion(request: Request, env: Env): Promise<VersionInfo> {
  try {
    const response = await env.ASSETS.fetch(
      new URL("/version.json", request.url),
    );
    return response.ok ? ((await response.json()) as VersionInfo) : {};
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      const version = await readVersion(request, env);
      return Response.json(
        { ok: true, service: "zvid-app", ...version },
        { headers: { "X-Zvid-Commit": version.commit ?? "unknown" } },
      );
    }

    if (url.pathname === "/api/ice-servers") {
      return handleIceServers(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
