import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiagnosticsRows,
  type CollaborationDiagnostics,
  DEFAULT_ICE_SERVERS,
  EMPTY_COLLABORATION_DIAGNOSTICS,
  hasTurnServer,
  PEER_UNREACHABLE_MESSAGE,
  parseIceServers,
  summarizeCollaboration,
} from "./collaboration-diagnostics.ts";

const SIGNAL = "wss://signal.example";

function diagnostics(
  overrides: Partial<CollaborationDiagnostics>,
): CollaborationDiagnostics {
  return {
    ...EMPTY_COLLABORATION_DIAGNOSTICS,
    signaling: [{ url: SIGNAL, connected: true }],
    ...overrides,
  };
}

describe("parseIceServers", () => {
  it("falls back to the STUN defaults when unset", () => {
    assert.deepEqual(parseIceServers(undefined), DEFAULT_ICE_SERVERS);
    assert.deepEqual(parseIceServers("  "), DEFAULT_ICE_SERVERS);
  });

  it("accepts an array of STUN and TURN servers", () => {
    const servers = parseIceServers(
      JSON.stringify([
        { urls: "stun:stun.example:3478" },
        {
          urls: ["turn:turn.example:3478", "turns:turn.example:5349"],
          username: "zvid",
          credential: "secret",
        },
      ]),
    );
    assert.equal(servers.length, 2);
    assert.equal(servers[1].username, "zvid");
    assert.equal(hasTurnServer(servers), true);
  });

  it("accepts a single server object", () => {
    assert.deepEqual(parseIceServers('{"urls":"turn:turn.example"}'), [
      { urls: "turn:turn.example" },
    ]);
  });

  it("rejects malformed config instead of ignoring it", () => {
    assert.throws(() => parseIceServers("turn:turn.example"), /valid JSON/);
    assert.throws(() => parseIceServers("[]"), /JSON array/);
    assert.throws(() => parseIceServers('[{"url":"stun:x"}]'), /JSON array/);
    assert.throws(
      () => parseIceServers('[{"urls":"turn:x","credential":1}]'),
      /JSON array/,
    );
  });
});

describe("hasTurnServer", () => {
  it("is false for STUN only", () => {
    assert.equal(hasTurnServer(DEFAULT_ICE_SERVERS), false);
  });
});

describe("summarizeCollaboration", () => {
  it("waits for the signaling server before reporting it unreachable", () => {
    const connecting = diagnostics({
      signaling: [{ url: SIGNAL, connected: false }],
    });
    assert.deepEqual(summarizeCollaboration("guest", connecting), {
      label: "Connecting to share...",
      tone: "pending",
    });
    assert.deepEqual(summarizeCollaboration("host", connecting), {
      label: "Opening share...",
      tone: "pending",
    });
    assert.deepEqual(
      summarizeCollaboration("guest", {
        ...connecting,
        signalingTimedOut: true,
      }),
      { label: "Can't reach the signaling server", tone: "error" },
    );
  });

  it("is fine when any one signaling server is connected", () => {
    const summary = summarizeCollaboration(
      "host",
      diagnostics({
        signaling: [
          { url: "wss://down.example", connected: false },
          { url: SIGNAL, connected: true },
        ],
        signalingTimedOut: true,
      }),
    );
    assert.deepEqual(summary, {
      label: "Sharing, waiting for peer",
      tone: "waiting",
    });
  });

  it("tells a guest it is waiting for the host, then that none was found", () => {
    assert.deepEqual(summarizeCollaboration("guest", diagnostics({})), {
      label: "Waiting for host...",
      tone: "waiting",
    });
    assert.equal(
      summarizeCollaboration("guest", diagnostics({ hostTimedOut: true })).tone,
      "error",
    );
  });

  it("reports unreachable peers once every found peer stalls", () => {
    assert.deepEqual(
      summarizeCollaboration("guest", diagnostics({ peersFound: 2 })),
      { label: "Connecting to peer...", tone: "pending" },
    );
    assert.deepEqual(
      summarizeCollaboration(
        "guest",
        diagnostics({ peersFound: 2, peersStalled: 1 }),
      ),
      { label: "Connecting to peer...", tone: "pending" },
    );
    assert.deepEqual(
      summarizeCollaboration(
        "host",
        diagnostics({ peersFound: 1, peersStalled: 1 }),
      ),
      { label: PEER_UNREACHABLE_MESSAGE, tone: "error" },
    );
  });

  it("shows a guest syncing until the project arrives", () => {
    assert.deepEqual(
      summarizeCollaboration(
        "guest",
        diagnostics({ peersFound: 1, peersConnected: 1 }),
      ),
      { label: "Connected, syncing project...", tone: "pending" },
    );
    assert.deepEqual(
      summarizeCollaboration(
        "guest",
        diagnostics({ peersFound: 1, peersConnected: 1, synced: true }),
      ),
      { label: "1 peer connected", tone: "live" },
    );
  });

  it("counts WebRTC peers and same-browser tabs as connected", () => {
    assert.deepEqual(
      summarizeCollaboration(
        "host",
        diagnostics({
          peersFound: 1,
          peersConnected: 1,
          sameBrowserPeers: 1,
          synced: true,
        }),
      ),
      { label: "2 peers connected", tone: "live" },
    );
  });
});

describe("buildDiagnosticsRows", () => {
  it("lists signaling per URL, peers, sync, relay and the last error", () => {
    const rows = buildDiagnosticsRows(
      "guest",
      diagnostics({
        signaling: [
          { url: SIGNAL, connected: true },
          { url: "wss://down.example", connected: false },
        ],
        signalingTimedOut: true,
        peersFound: 1,
        peersStalled: 1,
        lastError: "Ice connection failed.",
      }),
      DEFAULT_ICE_SERVERS,
    );
    assert.deepEqual(rows, [
      { label: `Signaling ${SIGNAL}`, value: "Connected", tone: "ok" },
      {
        label: "Signaling wss://down.example",
        value: "Unreachable",
        tone: "error",
      },
      { label: "Peers found", value: "1" },
      { label: "Peers connected (WebRTC)", value: "0", tone: "error" },
      { label: "Project state", value: "Waiting for host", tone: undefined },
      { label: "Relay (TURN)", value: "Not configured, STUN only" },
      {
        label: "Last error",
        value: "Ice connection failed.",
        tone: "error",
      },
    ]);
  });

  it("calls out same-browser tabs separately from WebRTC peers", () => {
    const rows = buildDiagnosticsRows(
      "host",
      diagnostics({ sameBrowserPeers: 1, synced: true }),
      DEFAULT_ICE_SERVERS,
    );
    assert.deepEqual(
      rows.find((row) => row.label === "Same-browser tabs"),
      { label: "Same-browser tabs", value: "1 (synced without WebRTC)" },
    );
    assert.equal(
      rows.find((row) => row.label === "Project state")?.value,
      "Published",
    );
  });
});
