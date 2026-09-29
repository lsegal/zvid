import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleIceServers,
  NATIVE_APP_ORIGINS,
  TURN_CREDENTIAL_TTL_SECONDS,
} from "../worker/turn.ts";

const ENV = { TURN_KEY_ID: "key-id", TURN_KEY_API_TOKEN: "api-token" };
const REQUEST = new Request("https://zvid.example/api/ice-servers");

function cloudflareReturning(response: Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("handleIceServers", () => {
  it("mints short-lived credentials with the Worker secrets", async () => {
    const { calls, fetcher } = cloudflareReturning(
      Response.json({
        iceServers: [
          {
            urls: [
              "stun:stun.cloudflare.com:3478",
              "stun:stun.cloudflare.com:53",
              "turn:turn.cloudflare.com:3478?transport=udp",
              "turn:turn.cloudflare.com:53?transport=udp",
              "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            username: "user",
            credential: "credential",
          },
        ],
      }),
    );

    const response = await handleIceServers(REQUEST, ENV, fetcher);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      iceServers: [
        {
          urls: [
            "stun:stun.cloudflare.com:3478",
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turns:turn.cloudflare.com:443?transport=tcp",
          ],
          username: "user",
          credential: "credential",
        },
      ],
    });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers",
    );
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(
      new Headers(calls[0].init?.headers).get("Authorization"),
      "Bearer api-token",
    );
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      ttl: TURN_CREDENTIAL_TTL_SECONDS,
    });
  });

  it("offers no relay without the secrets", async () => {
    const { calls, fetcher } = cloudflareReturning(Response.json({}));

    const response = await handleIceServers(
      REQUEST,
      { TURN_KEY_ID: "key-id" },
      fetcher,
    );

    assert.equal(response.status, 503);
    assert.deepEqual(calls, []);
  });

  it("reports Cloudflare failures without leaking the token", async () => {
    for (const upstream of [
      new Response("unauthorized", { status: 401 }),
      Response.json({}),
    ]) {
      const { fetcher } = cloudflareReturning(upstream);
      const originalError = console.error;
      console.error = () => {};
      try {
        const response = await handleIceServers(REQUEST, ENV, fetcher);
        assert.equal(response.status, 502);
        assert.doesNotMatch(await response.text(), /api-token/);
      } finally {
        console.error = originalError;
      }
    }
  });

  it("only answers GET", async () => {
    const { fetcher } = cloudflareReturning(Response.json({}));
    const response = await handleIceServers(
      new Request(REQUEST, { method: "POST" }),
      ENV,
      fetcher,
    );
    assert.equal(response.status, 405);
  });

  it("allows the native app's origins cross-origin", async () => {
    assert.deepEqual(NATIVE_APP_ORIGINS, [
      "tauri://localhost",
      "http://tauri.localhost",
    ]);
    for (const origin of NATIVE_APP_ORIGINS) {
      const { fetcher } = cloudflareReturning(
        Response.json({ iceServers: [{ urls: "turn:turn.example:3478" }] }),
      );
      const response = await handleIceServers(
        new Request(REQUEST, { headers: { Origin: origin } }),
        ENV,
        fetcher,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
      assert.equal(response.headers.get("Vary"), "Origin");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  });

  it("lets the native app read failures too", async () => {
    const response = await handleIceServers(
      new Request(REQUEST, { headers: { Origin: "tauri://localhost" } }),
      {},
    );
    assert.equal(response.status, 503);
    assert.equal(
      response.headers.get("Access-Control-Allow-Origin"),
      "tauri://localhost",
    );
  });

  it("allows no other cross-origin callers", async () => {
    for (const origin of [
      "https://evil.example",
      "https://zvid.example",
      "null",
      "tauri://localhost.evil.example",
    ]) {
      const { fetcher } = cloudflareReturning(
        Response.json({ iceServers: [{ urls: "turn:turn.example:3478" }] }),
      );
      const response = await handleIceServers(
        new Request(REQUEST, { headers: { Origin: origin } }),
        ENV,
        fetcher,
      );
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
      assert.equal(response.headers.get("Vary"), "Origin");

      const preflight = await handleIceServers(
        new Request(REQUEST, {
          method: "OPTIONS",
          headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
        }),
        ENV,
        fetcher,
      );
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), null);
      assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), null);
    }
  });

  it("answers the native app's CORS preflight without minting", async () => {
    for (const origin of NATIVE_APP_ORIGINS) {
      const { calls, fetcher } = cloudflareReturning(Response.json({}));
      const response = await handleIceServers(
        new Request(REQUEST, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "accept",
          },
        }),
        ENV,
        fetcher,
      );
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
      assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET");
      assert.equal(
        response.headers.get("Access-Control-Allow-Headers"),
        "Accept",
      );
      assert.equal(response.headers.get("Access-Control-Max-Age"), "86400");
      assert.equal(response.headers.get("Vary"), "Origin");
      assert.deepEqual(calls, []);
    }
  });
});
