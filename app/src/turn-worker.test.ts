import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleIceServers,
  type RateLimiter,
  TURN_CREDENTIAL_TTL_SECONDS,
  TURN_RATE_LIMIT_PERIOD_SECONDS,
} from "../worker/turn.ts";

const ENV = { TURN_KEY_ID: "key-id", TURN_KEY_API_TOKEN: "api-token" };
const REQUEST = new Request("https://zvid.example/api/ice-servers");

// Allows `limit` requests per key, like the Workers Rate Limiting binding.
function rateLimiter(limit: number) {
  const counts = new Map<string, number>();
  const limiter: RateLimiter = {
    async limit({ key }) {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
  return { counts, limiter };
}

function fromIp(ip: string, headers: Record<string, string> = {}) {
  return new Request(REQUEST, {
    headers: { "CF-Connecting-IP": ip, ...headers },
  });
}

const ICE_SERVERS = {
  iceServers: [{ urls: "turn:turn.cloudflare.com:3478", username: "u" }],
};

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

  it("rate-limits credential minting per client IP", async () => {
    const { counts, limiter } = rateLimiter(2);
    const env = { ...ENV, TURN_RATE_LIMITER: limiter };
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return Response.json(ICE_SERVERS);
    }) as typeof fetch;
    const mint = (ip: string) => handleIceServers(fromIp(ip), env, fetcher);

    assert.equal((await mint("192.0.2.1")).status, 200);
    assert.equal((await mint("192.0.2.1")).status, 200);
    const limited = await mint("192.0.2.1");
    assert.equal(limited.status, 429);
    assert.equal(
      limited.headers.get("Retry-After"),
      String(TURN_RATE_LIMIT_PERIOD_SECONDS),
    );
    assert.equal(limited.headers.get("Cache-Control"), "no-store");
    assert.equal((await mint("192.0.2.2")).status, 200);

    assert.equal(calls, 3);
    assert.deepEqual(Object.fromEntries(counts), {
      "192.0.2.1": 3,
      "192.0.2.2": 1,
    });
  });

  it("answers same-origin requests from the app", async () => {
    for (const headers of [
      { "Sec-Fetch-Site": "same-origin" },
      { "Sec-Fetch-Site": "same-origin", Origin: "https://zvid.example" },
      {},
    ] as Record<string, string>[]) {
      const { fetcher } = cloudflareReturning(Response.json(ICE_SERVERS));
      const response = await handleIceServers(
        fromIp("192.0.2.1", headers),
        ENV,
        fetcher,
      );
      assert.equal(response.status, 200);
    }
  });

  it("rejects requests from other origins", async () => {
    for (const headers of [
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" },
      { Origin: "https://evil.example" },
      { Origin: "null" },
    ] as Record<string, string>[]) {
      const { limiter, counts } = rateLimiter(10);
      const { calls, fetcher } = cloudflareReturning(
        Response.json(ICE_SERVERS),
      );
      const response = await handleIceServers(
        fromIp("192.0.2.1", headers),
        { ...ENV, TURN_RATE_LIMITER: limiter },
        fetcher,
      );
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.deepEqual(calls, []);
      assert.equal(counts.size, 0);
    }
  });
});
