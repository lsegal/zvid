type Env = {
  ASSETS: Fetcher;
};

const FFMPEG_WASM_PATH = "/ffmpeg/ffmpeg-core.wasm";
const FFMPEG_WASM_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "zvid-app" });
    }

    if (url.pathname === FFMPEG_WASM_PATH) {
      const response = await fetch(FFMPEG_WASM_CDN_URL);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
