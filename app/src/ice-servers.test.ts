import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiagnosticsRows,
  DEFAULT_ICE_SERVERS,
  EMPTY_COLLABORATION_DIAGNOSTICS,
} from "./collaboration-diagnostics.ts";
import {
  loadIceServers,
  mergeIceServers,
  parseRelayIceServers,
  resolveRelayIceServersUrl,
} from "./ice-servers.ts";

const RELAY_URL = "https://zvid.example/api/ice-servers";
const RELAY = [
  {
    urls: ["turn:turn.example:3478", "turns:turn.example:443?transport=tcp"],
    username: "short-lived",
    credential: "secret",
  },
];

function recordLog() {
  const events: { event: string; payload?: unknown }[] = [];
  return {
    events,
    log: (event: string, payload?: unknown) => {
      events.push({ event, payload });
    },
  };
}

function fetchReturning(response: Response | Error) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }) as typeof fetch;
  return { calls, fetcher };
}

function relayStatus(iceServers: RTCIceServer[]) {
  return buildDiagnosticsRows(
    "host",
    EMPTY_COLLABORATION_DIAGNOSTICS,
    iceServers,
  ).find((row) => row.label === "Relay (TURN)")?.value;
}

describe("resolveRelayIceServersUrl", () => {
  it("uses the app worker on the page's origin by default", () => {
    assert.equal(
      resolveRelayIceServersUrl(undefined, "https://zvid.example", false),
      RELAY_URL,
    );
  });

  it("prefers VITE_ICE_SERVERS_URL, and 'none' disables the relay", () => {
    assert.equal(
      resolveRelayIceServersUrl(
        " https://relay.example/ice ",
        "https://zvid.example",
        true,
      ),
      "https://relay.example/ice",
    );
    assert.equal(
      resolveRelayIceServersUrl("none", "https://zvid.example", false),
      null,
    );
  });

  it("has no default in the native app or without a web origin", () => {
    assert.equal(
      resolveRelayIceServersUrl(undefined, "http://tauri.localhost", true),
      null,
    );
    assert.equal(
      resolveRelayIceServersUrl(undefined, "tauri://localhost", false),
      null,
    );
    assert.equal(resolveRelayIceServersUrl(undefined, undefined, false), null);
  });
});

describe("mergeIceServers", () => {
  it("adds the relay after the configured servers", () => {
    assert.deepEqual(mergeIceServers(DEFAULT_ICE_SERVERS, RELAY), [
      ...DEFAULT_ICE_SERVERS,
      ...RELAY,
    ]);
  });

  it("skips relay servers that are already configured", () => {
    assert.deepEqual(
      mergeIceServers([...DEFAULT_ICE_SERVERS, ...RELAY], RELAY),
      [...DEFAULT_ICE_SERVERS, ...RELAY],
    );
  });
});

describe("parseRelayIceServers", () => {
  it("accepts the worker's response", () => {
    assert.deepEqual(parseRelayIceServers({ iceServers: RELAY }), RELAY);
  });

  it("rejects missing, empty and malformed servers", () => {
    for (const body of [
      null,
      {},
      { iceServers: [] },
      { iceServers: [{ urls: 3 }] },
      { error: "TURN relay is not configured" },
    ]) {
      assert.throws(() => parseRelayIceServers(body), /no ICE servers/);
    }
  });
});

describe("loadIceServers", () => {
  it("merges the fetched relay with the configured servers", async () => {
    const { events, log } = recordLog();
    const { calls, fetcher } = fetchReturning(
      Response.json({ iceServers: RELAY }),
    );

    const servers = await loadIceServers(DEFAULT_ICE_SERVERS, RELAY_URL, {
      fetch: fetcher,
      log,
    });

    assert.deepEqual(calls, [RELAY_URL]);
    assert.deepEqual(servers, [...DEFAULT_ICE_SERVERS, ...RELAY]);
    assert.equal(relayStatus(servers), "Configured");
    assert.deepEqual(
      events.map((entry) => entry.event),
      ["collaboration:ice:relay"],
    );
  });

  it("falls back to the configured servers when the worker has no relay", async () => {
    const { events, log } = recordLog();
    const { fetcher } = fetchReturning(
      Response.json({ error: "TURN relay is not configured" }, { status: 503 }),
    );

    const servers = await loadIceServers(DEFAULT_ICE_SERVERS, RELAY_URL, {
      fetch: fetcher,
      log,
    });

    assert.equal(servers, DEFAULT_ICE_SERVERS);
    assert.equal(relayStatus(servers), "Not configured, STUN only");
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "collaboration:ice:relay:error");
    assert.match(
      (events[0].payload as { error: string }).error,
      /responded 503/,
    );
  });

  it("falls back when the fetch fails or returns something else", async () => {
    for (const response of [
      new TypeError("Failed to fetch"),
      new Response("<!doctype html>", {
        headers: { "Content-Type": "text/html" },
      }),
      Response.json({ iceServers: [] }),
    ]) {
      const { events, log } = recordLog();
      const { fetcher } = fetchReturning(response);

      const servers = await loadIceServers(DEFAULT_ICE_SERVERS, RELAY_URL, {
        fetch: fetcher,
        log,
      });

      assert.equal(servers, DEFAULT_ICE_SERVERS);
      assert.deepEqual(
        events.map((entry) => entry.event),
        ["collaboration:ice:relay:error"],
      );
    }
  });

  it("falls back when the relay doesn't answer in time", async () => {
    const { events, log } = recordLog();
    const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      })) as typeof fetch;

    const servers = await loadIceServers(DEFAULT_ICE_SERVERS, RELAY_URL, {
      fetch: fetcher,
      log,
      timeoutMs: 10,
    });

    assert.equal(servers, DEFAULT_ICE_SERVERS);
    assert.equal(events[0].event, "collaboration:ice:relay:error");
  });

  it("doesn't fetch without a relay URL", async () => {
    const { calls, fetcher } = fetchReturning(new Error("unexpected"));

    const servers = await loadIceServers(DEFAULT_ICE_SERVERS, null, {
      fetch: fetcher,
    });

    assert.equal(servers, DEFAULT_ICE_SERVERS);
    assert.deepEqual(calls, []);
  });
});
